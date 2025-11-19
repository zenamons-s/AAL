# Stage 13 Quick Reference Guide

## 🚀 Quick Start

### Enable Adaptive Loading with Logging
```bash
# In .env or environment
USE_ADAPTIVE_DATA_LOADING=true
LOG_LEVEL=info  # Options: debug, info, warn, error
```

---

## 📝 Logging

### Import Logger
```typescript
import { getLogger } from '../../shared/logger/Logger';

const logger = getLogger('MyService');
```

### Basic Logging
```typescript
// Info
logger.info('Operation successful', {
  module: 'MyService',
  operation: 'processData',
  recordsProcessed: 150
});

// Warning
logger.warn('Slow operation detected', {
  module: 'MyService',
  operation: 'loadData',
  duration_ms: 2500
});

// Error
logger.error('Operation failed', error, {
  module: 'MyService',
  operation: 'saveData',
  error: error.message
});

// Debug
logger.debug('Processing step', {
  module: 'MyService',
  operation: 'validate',
  step: 3,
  itemId: '123'
});
```

### Performance Timing
```typescript
const stopTimer = logger.startTimer('expensiveOperation');

// ... do work ...

stopTimer(); // Automatically logs: "Operation completed" with duration_ms
```

---

## 📊 Metrics

### Import Metrics Registry
```typescript
import { getMetricsRegistry } from '../../shared/metrics/MetricsRegistry';

const metrics = getMetricsRegistry();
```

### Record Request
```typescript
metrics.recordRequest({
  mode: DataSourceMode.REAL,
  quality: 95,
  loadTime_ms: 250,
  timestamp: new Date(),
  cacheHit: false
});
```

### Record Error
```typescript
metrics.recordError({
  source: 'odata',  // 'odata' | 'recovery' | 'cache' | 'mock'
  message: 'Connection timeout',
  timestamp: new Date()
});
```

### Get Metrics Summary
```typescript
const summary = metrics.getSummary();
console.log(`Total requests: ${summary.requests.total}`);
console.log(`Average quality: ${summary.quality.average}`);
console.log(`Cache hit rate: ${summary.cache.hitRate}%`);
console.log(`Error rate: ${summary.errors.last24h / summary.requests.last24h}`);
```

### Get Mode-Specific Stats
```typescript
const realStats = metrics.getModeStats(DataSourceMode.REAL);
console.log(`REAL mode count: ${realStats.count}`);
console.log(`REAL mode avg quality: ${realStats.averageQuality}`);
console.log(`REAL mode avg load time: ${realStats.averageLoadTime_ms}ms`);
```

---

## 🛡️ Error Handling

### Import Error Classes
```typescript
import {
  ODataConnectionError,
  ODataTimeoutError,
  CacheError,
  DataRecoveryError,
  shouldFallbackToMock,
  getUserFriendlyMessage
} from '../../shared/errors';
```

### Throw Custom Errors
```typescript
// OData errors
throw new ODataConnectionError(
  'https://api.example.com/odata',
  originalError
);

throw new ODataTimeoutError(30000);

// Cache errors
throw new CacheWriteError('transport-dataset', originalError);

// Recovery errors
throw new CoordinateRecoveryError('stop-123');
```

### Handle Errors with Fallback
```typescript
try {
  const data = await odataProvider.loadData();
} catch (error) {
  if (shouldFallbackToMock(error)) {
    // Safe to use mock data
    logger.warn('Falling back to mock data', { error: error.message });
    return await mockProvider.loadData();
  }
  
  // Critical error, cannot recover
  throw error;
}
```

### User-Friendly Error Messages
```typescript
try {
  // ... operation ...
} catch (error) {
  const userMessage = getUserFriendlyMessage(error as Error);
  
  res.status(503).json({
    status: 'error',
    message: userMessage  // "Unable to connect to the transport data service..."
  });
}
```

---

## 🔍 Diagnostics

### Check System Status
```bash
curl http://localhost:5000/api/v1/diagnostics/adaptive-data
```

### Response Structure
```json
{
  "status": "ok",
  "enabled": true,
  "providers": { ... },
  "cache": {
    "hitRate": "85.5%",
    "hits": 342,
    "misses": 58
  },
  "metrics": {
    "requests": {
      "total": 1250,
      "byMode": {
        "real": 350,
        "recovery": 75,
        "mock": 25
      }
    },
    "quality": {
      "average": 92.5,
      "last10": [95, 93, 94, ...]
    },
    "performance": {
      "averageLoadTime_ms": 275,
      "p95LoadTime_ms": 450
    },
    "errors": {
      "total": 45,
      "last24h": 12
    }
  },
  "modeStats": {
    "real": { "count": 350, "averageQuality": 94.2 },
    "recovery": { "count": 75, "averageQuality": 78.5 },
    "mock": { "count": 25, "averageQuality": 100 }
  }
}
```

---

## 🎯 Common Patterns

### Pattern 1: Service with Logging and Metrics
```typescript
import { getLogger } from '../../shared/logger/Logger';
import { getMetricsRegistry } from '../../shared/metrics/MetricsRegistry';

class MyService {
  private logger = getLogger('MyService');
  private metrics = getMetricsRegistry();
  
  async processData(): Promise<Result> {
    const stopTimer = this.logger.startTimer('processData');
    const startTime = Date.now();
    
    try {
      this.logger.info('Processing started', {
        module: 'MyService',
        operation: 'processData'
      });
      
      // ... do work ...
      
      const loadTime = Date.now() - startTime;
      
      this.logger.info('Processing completed', {
        module: 'MyService',
        operation: 'processData',
        loadTime_ms: loadTime
      });
      
      this.metrics.recordRequest({
        mode: DataSourceMode.REAL,
        quality: 100,
        loadTime_ms: loadTime,
        timestamp: new Date(),
        cacheHit: false
      });
      
      stopTimer();
      return result;
      
    } catch (error) {
      stopTimer();
      const err = error as Error;
      
      this.logger.error('Processing failed', err, {
        module: 'MyService',
        operation: 'processData',
        error: err.message
      });
      
      this.metrics.recordError({
        source: 'odata',
        message: err.message,
        timestamp: new Date()
      });
      
      throw error;
    }
  }
}
```

### Pattern 2: Graceful Degradation
```typescript
async function loadDataWithFallback(): Promise<Dataset> {
  const logger = getLogger('DataLoader');
  
  // Try primary source
  try {
    const data = await primaryProvider.loadData();
    logger.info('Data loaded from primary source');
    return data;
  } catch (error) {
    logger.warn('Primary source failed, trying cache', { error: error.message });
    
    // Try cache
    try {
      const cachedData = await cache.get('dataset');
      if (cachedData) {
        logger.info('Data loaded from cache');
        return cachedData;
      }
    } catch (cacheError) {
      logger.warn('Cache also failed', { error: cacheError.message });
    }
    
    // Fallback to mock
    if (shouldFallbackToMock(error)) {
      logger.info('Using mock data as final fallback');
      return await mockProvider.loadData();
    }
    
    throw error;
  }
}
```

### Pattern 3: Monitoring Health
```typescript
async function checkSystemHealth(): Promise<HealthStatus> {
  const metrics = getMetricsRegistry();
  const summary = metrics.getSummary();
  
  const health: HealthStatus = {
    status: 'ok',
    checks: {
      errorRate: summary.errors.last24h / summary.requests.last24h,
      cacheHitRate: summary.cache.hitRate / 100,
      averageQuality: summary.quality.average / 100,
      p95LoadTime: summary.performance.p95LoadTime_ms
    }
  };
  
  // Check thresholds
  if (health.checks.errorRate > 0.05) health.status = 'warning';
  if (health.checks.cacheHitRate < 0.7) health.status = 'warning';
  if (health.checks.averageQuality < 0.8) health.status = 'warning';
  if (health.checks.p95LoadTime > 1000) health.status = 'warning';
  
  return health;
}
```

---

## 🧪 Testing Examples

### Test Logging
```typescript
import { getLogger } from '../../shared/logger/Logger';

describe('MyService', () => {
  let consoleInfoSpy: jest.SpyInstance;
  
  beforeEach(() => {
    consoleInfoSpy = jest.spyOn(console, 'info');
  });
  
  it('should log operation start', async () => {
    const logger = getLogger('MyService');
    logger.info('Test message', { module: 'MyService', operation: 'test' });
    
    expect(consoleInfoSpy).toHaveBeenCalled();
    const logEntry = JSON.parse(consoleInfoSpy.mock.calls[0][0]);
    expect(logEntry.message).toBe('Test message');
    expect(logEntry.module).toBe('MyService');
  });
});
```

### Test Metrics
```typescript
import { getMetricsRegistry } from '../../shared/metrics/MetricsRegistry';
import { DataSourceMode } from '../../domain/enums/DataSourceMode';

describe('MetricsRegistry', () => {
  it('should track requests', () => {
    const metrics = getMetricsRegistry();
    metrics.reset(); // Clean slate
    
    metrics.recordRequest({
      mode: DataSourceMode.REAL,
      quality: 95,
      loadTime_ms: 250,
      timestamp: new Date(),
      cacheHit: false
    });
    
    const summary = metrics.getSummary();
    expect(summary.requests.total).toBe(1);
    expect(summary.requests.byMode.real).toBe(1);
    expect(summary.quality.average).toBe(95);
  });
});
```

### Test Error Handling
```typescript
import {
  ODataConnectionError,
  shouldFallbackToMock
} from '../../shared/errors';

describe('Error Handling', () => {
  it('should recommend fallback for connection errors', () => {
    const error = new ODataConnectionError('https://api.example.com', new Error());
    expect(shouldFallbackToMock(error)).toBe(true);
  });
  
  it('should not fallback for critical errors', () => {
    const error = new MockProviderError('Mock data corrupted');
    expect(shouldFallbackToMock(error)).toBe(false);
  });
});
```

---

## 🔧 Configuration

### Environment Variables
```bash
# Required
USE_ADAPTIVE_DATA_LOADING=true

# Optional Logging
LOG_LEVEL=info  # debug | info | warn | error (default: info)

# Optional Cache
REDIS_ENABLED=true
CACHE_TTL=3600  # seconds
```

---

## 📞 Support & Troubleshooting

### No Logs Appearing
- Check `LOG_LEVEL` setting (may be set to ERROR)
- Verify logger is imported correctly
- Ensure `USE_ADAPTIVE_DATA_LOADING=true`

### Metrics Not Updating
- Check that requests are being recorded
- Verify diagnostics endpoint is accessible
- Check for metrics cleanup (24h retention)

### Error Handling Not Working
- Ensure errors extend `AdaptiveLoadingError`
- Check error severity levels
- Verify `shouldFallbackToMock()` logic

---

## 📚 Additional Resources

- **Full Implementation Report:** `STAGE_13_COMPLETE.md`
- **Comprehensive Summary:** `STAGE_13_SUMMARY.md`
- **Architecture Docs:** `architecture/` directory
- **Testing Guide:** `STAGE_12_COMPLETE.md`

---

*Quick Reference for Stage 13: Production-Ready System*


