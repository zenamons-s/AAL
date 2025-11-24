/**
 * Data Initialization Module
 * 
 * Checks if database tables are empty and triggers automatic data loading.
 * Ensures backend is ready with data after startup.
 * 
 * @module infrastructure/startup
 */

import type { Pool } from 'pg';
import type { RedisClientType } from 'redis';
import {
  PostgresStopRepository,
  PostgresRouteRepository,
  PostgresFlightRepository,
  PostgresDatasetRepository,
  PostgresGraphRepository,
} from '../repositories';
import { initializeWorkers } from '../workers/initializeWorkers';
import { getWorkerOrchestrator } from '../../application/workers';

/**
 * Data availability check result
 */
export type DataAvailabilityResult = {
  hasData: boolean;
  realStopsCount: number;
  virtualStopsCount: number;
  routesCount: number;
  flightsCount: number;
  datasetsCount: number;
  isEmpty: boolean;
};

/**
 * Data completeness check result
 */
export type DataCompletenessResult = {
  isComplete: boolean;
  needsPipeline: boolean;
  reasons: string[];
  realStopsCount: number;
  virtualStopsCount: number;
  virtualStopsInStopsTable: number; // Critical: virtual stops incorrectly in stops table
  invalidVirtualStopsCount: number; // Virtual stops with empty city_id
  invalidStopIdsCount: number; // Stops with invalid IDs (multiple dashes)
  routesCount: number;
  flightsCount: number;
  graphExists: boolean;
  graphVersion?: string;
  graphNodes: number;
  graphEdges: number;
  graphDatasetVersion?: string;
  latestDatasetVersion?: string;
  versionsMatch: boolean;
};

/**
 * Check if database has any data
 * 
 * @param pool - PostgreSQL connection pool
 * @returns Data availability result
 */
export async function checkDataAvailability(pool: Pool): Promise<DataAvailabilityResult> {
  const stopRepository = new PostgresStopRepository(pool);
  const routeRepository = new PostgresRouteRepository(pool);
  const flightRepository = new PostgresFlightRepository(pool);
  const datasetRepository = new PostgresDatasetRepository(pool);

  const [realStopsCount, virtualStopsCount, routesCount, flightsCount, datasetsCount] = await Promise.all([
    stopRepository.countRealStops(),
    stopRepository.countVirtualStops(),
    routeRepository.countRoutes(),
    flightRepository.countFlights(true), // Include virtual flights
    datasetRepository.countDatasets(),
  ]);

  const hasData = realStopsCount > 0 || virtualStopsCount > 0 || routesCount > 0 || flightsCount > 0;
  const isEmpty = realStopsCount === 0 && virtualStopsCount === 0 && routesCount === 0 && flightsCount === 0;

  return {
    hasData,
    realStopsCount,
    virtualStopsCount,
    routesCount,
    flightsCount,
    datasetsCount,
    isEmpty,
  };
}

/**
 * Check data completeness and graph state
 * 
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client
 * @returns Data completeness check result
 */
export async function checkDataCompleteness(
  pool: Pool,
  redis: RedisClientType
): Promise<DataCompletenessResult> {
  const stopRepository = new PostgresStopRepository(pool);
  const routeRepository = new PostgresRouteRepository(pool);
  const flightRepository = new PostgresFlightRepository(pool);
  const datasetRepository = new PostgresDatasetRepository(pool);
  const graphRepository = new PostgresGraphRepository(pool, redis);

  const reasons: string[] = [];
  let needsPipeline = false;

  // ============================================================================
  // CRITICAL CHECKS (executed first - highest priority)
  // ============================================================================

  // Check for virtual stops incorrectly stored in stops table (CRITICAL)
  const virtualStopsInStopsResult = await pool.query(
    "SELECT COUNT(*) as count FROM stops WHERE id LIKE 'virtual-stop-%'"
  );
  const virtualStopsInStopsTable = parseInt(virtualStopsInStopsResult.rows[0]?.count || '0', 10);

  if (virtualStopsInStopsTable > 0) {
    reasons.push(`Found ${virtualStopsInStopsTable} virtual stops in stops table (should be in virtual_stops only)`);
    needsPipeline = true;
  }

  // Check for invalid virtual stops with empty city_id (CRITICAL)
  const invalidVirtualStopsResult = await pool.query(
    "SELECT COUNT(*) as count FROM stops WHERE (city_id IS NULL OR city_id = '') AND id LIKE 'virtual-stop-%'"
  );
  const invalidVirtualStopsCount = parseInt(invalidVirtualStopsResult.rows[0]?.count || '0', 10);

  if (invalidVirtualStopsCount > 0) {
    reasons.push(`Found ${invalidVirtualStopsCount} invalid virtual stops with empty city_id`);
    needsPipeline = true;
  }

  // Check for invalid stop IDs (multiple consecutive dashes, empty city name) (CRITICAL)
  const invalidStopIdsResult = await pool.query(
    "SELECT COUNT(*) as count FROM stops WHERE id = 'virtual-stop----------------' OR id ~ '^virtual-stop-+$'"
  );
  const invalidStopIdsCount = parseInt(invalidStopIdsResult.rows[0]?.count || '0', 10);

  if (invalidStopIdsCount > 0) {
    reasons.push(`Found ${invalidStopIdsCount} invalid virtual stops with empty city name`);
    needsPipeline = true;
  }

  // Check for routes/flights referencing deleted virtual stops
  const routesWithVirtualStopsResult = await pool.query(
    "SELECT COUNT(*) as count FROM routes WHERE from_stop_id LIKE 'virtual-stop-%' OR to_stop_id LIKE 'virtual-stop-%'"
  );
  const routesWithVirtualStops = parseInt(routesWithVirtualStopsResult.rows[0]?.count || '0', 10);

  if (routesWithVirtualStops > 0) {
    reasons.push(`Found ${routesWithVirtualStops} routes referencing virtual stops (should be cleaned up)`);
    needsPipeline = true;
  }

  const flightsWithVirtualStopsResult = await pool.query(
    "SELECT COUNT(*) as count FROM flights WHERE from_stop_id LIKE 'virtual-stop-%' OR to_stop_id LIKE 'virtual-stop-%'"
  );
  const flightsWithVirtualStops = parseInt(flightsWithVirtualStopsResult.rows[0]?.count || '0', 10);

  if (flightsWithVirtualStops > 0) {
    reasons.push(`Found ${flightsWithVirtualStops} flights referencing virtual stops (should be cleaned up)`);
    needsPipeline = true;
  }

  // ============================================================================
  // STANDARD CHECKS (executed after critical checks)
  // ============================================================================

  const [realStopsCount, virtualStopsCount, routesCount, flightsCount, latestDataset] = await Promise.all([
    stopRepository.countRealStops(),
    stopRepository.countVirtualStops(),
    routeRepository.countRoutes(),
    flightRepository.countFlights(true),
    datasetRepository.getLatestDataset(),
  ]);

  // Check data completeness
  const MIN_STOPS = 10;
  const MIN_ROUTES = 5;
  const MIN_FLIGHTS = 10;

  if (realStopsCount === 0) {
    reasons.push('No real stops found');
    needsPipeline = true;
  } else if (realStopsCount < MIN_STOPS) {
    reasons.push(`Too few real stops: ${realStopsCount} < ${MIN_STOPS}`);
    needsPipeline = true;
  }

  if (virtualStopsCount === 0) {
    reasons.push('No virtual stops found');
    needsPipeline = true;
  }

  if (routesCount === 0) {
    reasons.push('No routes found');
    needsPipeline = true;
  } else if (routesCount < MIN_ROUTES) {
    reasons.push(`Too few routes: ${routesCount} < ${MIN_ROUTES}`);
    needsPipeline = true;
  }

  if (flightsCount === 0) {
    reasons.push('No flights found');
    needsPipeline = true;
  } else if (flightsCount < MIN_FLIGHTS) {
    reasons.push(`Too few flights: ${flightsCount} < ${MIN_FLIGHTS}`);
    needsPipeline = true;
  }

  // Check for key cities (Верхоянск, Мирный) in stops
  const keyCitiesResult = await pool.query(
    `SELECT COUNT(DISTINCT city_id) as count FROM stops 
     WHERE city_id IN ('Верхоянск', 'Мирный', 'Верхоянский', 'Мирнинский')
        OR name ILIKE '%верхоянск%'
        OR name ILIKE '%мирный%'`
  );
  const keyCitiesCount = parseInt(keyCitiesResult.rows[0]?.count || '0', 10);

  if (keyCitiesCount === 0) {
    reasons.push('Key cities (Верхоянск, Мирный) not found in stops');
    needsPipeline = true;
  }

  // Check graph state
  const graphVersion = await graphRepository.getGraphVersion();
  const graphMetadata = graphVersion ? await graphRepository.getGraphMetadata() : undefined;
  const graphNodes = graphMetadata?.nodes || 0;
  const graphEdges = graphMetadata?.edges || 0;
  const graphDatasetVersion = graphMetadata?.datasetVersion;
  const latestDatasetVersion = latestDataset?.version;

  const MIN_GRAPH_NODES = 36; // Updated for full graph with all cities
  const MIN_GRAPH_EDGES = 160; // Updated for full graph with transfers and ferry

  if (!graphVersion) {
    reasons.push('Graph not found in Redis');
    needsPipeline = true;
  } else if (!graphMetadata) {
    reasons.push('Graph metadata not found');
    needsPipeline = true;
  } else {
    if (graphNodes === 0) {
      reasons.push('Graph is empty (no nodes)');
      needsPipeline = true;
    } else if (graphNodes < MIN_GRAPH_NODES) {
      reasons.push(`Graph too small: ${graphNodes} nodes < ${MIN_GRAPH_NODES}`);
      needsPipeline = true;
    }

    if (graphEdges === 0) {
      reasons.push('Graph has no edges');
      needsPipeline = true;
    } else if (graphEdges < MIN_GRAPH_EDGES) {
      reasons.push(`Graph too sparse: ${graphEdges} edges < ${MIN_GRAPH_EDGES}`);
      needsPipeline = true;
    }

    // Check version match
    if (latestDatasetVersion && graphDatasetVersion !== latestDatasetVersion) {
      reasons.push(`Graph version mismatch: graph=${graphDatasetVersion}, dataset=${latestDatasetVersion}`);
      needsPipeline = true;
    } else if (!latestDatasetVersion && graphDatasetVersion) {
      reasons.push('Dataset not found but graph exists');
      needsPipeline = true;
    }
  }

  // Determine if data is complete
  // Data is complete ONLY if all critical checks pass AND all standard checks pass
  const isComplete = !needsPipeline && 
    virtualStopsInStopsTable === 0 && // CRITICAL: No virtual stops in stops table
    invalidVirtualStopsCount === 0 && // CRITICAL: No invalid virtual stops
    invalidStopIdsCount === 0 && // CRITICAL: No invalid stop IDs
    routesWithVirtualStops === 0 && // CRITICAL: No routes referencing virtual stops
    flightsWithVirtualStops === 0 && // CRITICAL: No flights referencing virtual stops
    realStopsCount >= MIN_STOPS &&
    virtualStopsCount > 0 &&
    routesCount >= MIN_ROUTES &&
    flightsCount >= MIN_FLIGHTS &&
    keyCitiesCount > 0 && // Key cities must be present
    graphVersion !== undefined &&
    graphMetadata !== undefined &&
    graphNodes >= MIN_GRAPH_NODES &&
    graphEdges >= MIN_GRAPH_EDGES &&
    (latestDatasetVersion === undefined || graphDatasetVersion === latestDatasetVersion);

  return {
    isComplete,
    needsPipeline,
    reasons,
    realStopsCount,
    virtualStopsCount,
    virtualStopsInStopsTable,
    invalidVirtualStopsCount,
    invalidStopIdsCount,
    routesCount,
    flightsCount,
    graphExists: graphVersion !== undefined,
    graphVersion,
    graphNodes,
    graphEdges,
    graphDatasetVersion,
    latestDatasetVersion,
    versionsMatch: latestDatasetVersion !== undefined && graphDatasetVersion === latestDatasetVersion,
  };
}

/**
 * Initialize workers and execute full pipeline if data is incomplete or graph is outdated
 * 
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client
 * @returns True if pipeline was executed, false otherwise
 */
export async function ensureDataInitialized(
  pool: Pool,
  redis: RedisClientType
): Promise<boolean> {
  console.log('\n🔍 Checking data completeness and graph state...');
  console.log('─────────────────────────────────────────────────────────────');

  const completenessCheck = await checkDataCompleteness(pool, redis);

  console.log(`📊 Data Status:`);
  console.log(`   Real stops: ${completenessCheck.realStopsCount}`);
  console.log(`   Virtual stops (in virtual_stops): ${completenessCheck.virtualStopsCount}`);
  
  // Critical checks - show prominently
  if (completenessCheck.virtualStopsInStopsTable > 0) {
    console.log(`   ⚠️  Virtual stops in stops table (CRITICAL): ${completenessCheck.virtualStopsInStopsTable}`);
  }
  if (completenessCheck.invalidVirtualStopsCount > 0) {
    console.log(`   ⚠️  Invalid virtual stops (empty city_id): ${completenessCheck.invalidVirtualStopsCount}`);
  }
  if (completenessCheck.invalidStopIdsCount > 0) {
    console.log(`   ⚠️  Invalid stop IDs (multiple dashes): ${completenessCheck.invalidStopIdsCount}`);
  }
  
  console.log(`   Routes: ${completenessCheck.routesCount}`);
  console.log(`   Flights: ${completenessCheck.flightsCount}`);
  console.log(`   Graph exists: ${completenessCheck.graphExists ? 'Yes' : 'No'}`);
  if (completenessCheck.graphVersion) {
    console.log(`   Graph version: ${completenessCheck.graphVersion}`);
    console.log(`   Graph nodes: ${completenessCheck.graphNodes}`);
    console.log(`   Graph edges: ${completenessCheck.graphEdges}`);
    console.log(`   Graph dataset version: ${completenessCheck.graphDatasetVersion || 'N/A'}`);
  }
  if (completenessCheck.latestDatasetVersion) {
    console.log(`   Latest dataset version: ${completenessCheck.latestDatasetVersion}`);
  }
  console.log(`   Versions match: ${completenessCheck.versionsMatch ? 'Yes' : 'No'}`);

  if (completenessCheck.isComplete && !completenessCheck.needsPipeline) {
    console.log('✅ Data is complete and graph is up-to-date - skipping automatic initialization');
    console.log('');
    return false;
  }

  if (completenessCheck.reasons.length > 0) {
    console.log('⚠️  Data is incomplete or graph needs rebuild:');
    console.log('   Failed checks:');
    completenessCheck.reasons.forEach(reason => console.log(`      - ${reason}`));
    
    // Summary of why pipeline is running
    if (completenessCheck.virtualStopsInStopsTable > 0) {
      console.log(`   🔴 CRITICAL: ${completenessCheck.virtualStopsInStopsTable} virtual stops found in stops table`);
      console.log(`      These should only exist in virtual_stops table. Pipeline will clean them up.`);
    }
    if (completenessCheck.invalidVirtualStopsCount > 0 || completenessCheck.invalidStopIdsCount > 0) {
      console.log(`   🔴 CRITICAL: Invalid virtual stops detected`);
      console.log(`      Pipeline will remove these invalid stops.`);
    }
  }
  
  console.log('🚀 Starting automatic data initialization...');
  console.log('');

  try {
    // ========================================================================
    // Step 1: Initialize Workers
    // ========================================================================
    console.log('🔧 Step 1: Initializing background workers...');
    await initializeWorkers(pool, redis);
    console.log('✅ Workers initialized\n');

    // ========================================================================
    // Step 2: Execute Full Pipeline
    // ========================================================================
    console.log('🚀 Step 2: Executing full data pipeline...');
    console.log('   This may take several minutes...\n');

    const orchestrator = getWorkerOrchestrator();
    const result = await orchestrator.executeFullPipeline();

    if (result.success) {
      console.log('\n✅ Data initialization completed successfully!');
      console.log(`   Total time: ${result.totalExecutionTimeMs}ms`);
      console.log(`   Workers executed: ${result.workersExecuted}`);
      console.log('');

      // Verify data was loaded
      const finalCheck = await checkDataAvailability(pool);
      console.log('📊 Final Data Status:');
      console.log(`   Real stops: ${finalCheck.realStopsCount}`);
      console.log(`   Virtual stops: ${finalCheck.virtualStopsCount}`);
      console.log(`   Routes: ${finalCheck.routesCount}`);
      console.log(`   Flights: ${finalCheck.flightsCount}`);
      console.log('');

      if (finalCheck.hasData) {
        console.log('✅ Database populated successfully!');
        console.log('');
        return true;
      } else {
        console.warn('⚠️ Pipeline completed but database is still empty');
        console.warn('   Check worker logs for errors');
        console.log('');
        return false;
      }
    } else {
      console.error('\n❌ Data initialization failed!');
      console.error(`   Error: ${result.error}`);
      console.error(`   Workers executed: ${result.workersExecuted}`);
      console.log('');
      return false;
    }
  } catch (error: any) {
    console.error('\n❌ Data initialization error:', error?.message || String(error));
    console.error('   Stack:', error?.stack);
    console.log('');
    return false;
  }
}

