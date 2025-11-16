/**
 * Парсер метаданных OData ($metadata)
 * Использует простой парсинг XML через регулярные выражения и DOM API (если доступен)
 */

export interface IODataProperty {
  Name: string;
  Type: string;
  Nullable?: boolean;
  MaxLength?: number;
  Precision?: number;
  Scale?: number;
}

export interface IODataNavigationProperty {
  Name: string;
  Type: string;
  Partner?: string;
}

export interface IODataEntityType {
  Name: string;
  Key?: {
    PropertyRef: Array<{
      Name: string;
    }>;
  };
  Property: IODataProperty[];
  NavigationProperty?: IODataNavigationProperty[];
}

export interface IODataComplexType {
  Name: string;
  Property: IODataProperty[];
}

export interface IODataEntitySet {
  Name: string;
  EntityType: string;
}

export interface IODataSchema {
  Namespace: string;
  EntityType: IODataEntityType[];
  ComplexType?: IODataComplexType[];
  EntityContainer: {
    EntitySet: IODataEntitySet[];
  };
}

export interface IODataMetadata {
  'edmx:Edmx': {
    'edmx:DataServices': {
      Schema: IODataSchema[];
    };
  };
}

export class ODataMetadataParser {
  /**
   * Парсить метаданные из XML
   */
  async parseMetadata(xmlString: string): Promise<IODataMetadata> {
    try {
      // Используем простой парсинг через регулярные выражения для Node.js
      return this.parseXMLString(xmlString);
    } catch (error) {
      throw new Error(
        `Failed to parse OData metadata: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Парсить XML строку
   */
  private parseXMLString(xmlString: string): IODataMetadata {
    // Простой парсер XML через регулярные выражения
    const edmxMatch = xmlString.match(/<Edmx[^>]*>([\s\S]*?)<\/Edmx>/i);
    if (!edmxMatch) {
      throw new Error('Edmx element not found');
    }

    const dataServicesMatch = edmxMatch[1].match(/<DataServices[^>]*>([\s\S]*?)<\/DataServices>/i);
    if (!dataServicesMatch) {
      throw new Error('DataServices element not found');
    }

    const schemaMatches = dataServicesMatch[1].matchAll(/<Schema[^>]*>([\s\S]*?)<\/Schema>/gi);
    const schemas: IODataSchema[] = [];

    for (const schemaMatch of schemaMatches) {
      const schemaContent = schemaMatch[1];
      const namespaceMatch = schemaMatch[0].match(/Namespace="([^"]*)"/i);
      const namespace = namespaceMatch ? namespaceMatch[1] : '';

      const entityTypes = this.parseEntityTypes(schemaContent);
      const complexTypes = this.parseComplexTypes(schemaContent);
      const entitySets = this.parseEntitySets(schemaContent);

      schemas.push({
        Namespace: namespace,
        EntityType: entityTypes,
        ComplexType: complexTypes.length > 0 ? complexTypes : undefined,
        EntityContainer: {
          EntitySet: entitySets,
        },
      });
    }

    return {
      'edmx:Edmx': {
        'edmx:DataServices': {
          Schema: schemas,
        },
      },
    };
  }

  /**
   * Парсить EntityTypes из содержимого Schema
   */
  private parseEntityTypes(schemaContent: string): IODataEntityType[] {
    const entityTypeMatches = schemaContent.matchAll(/<EntityType[^>]*>([\s\S]*?)<\/EntityType>/gi);
    const entityTypes: IODataEntityType[] = [];

    for (const match of entityTypeMatches) {
      const nameMatch = match[0].match(/Name="([^"]*)"/i);
      const name = nameMatch ? nameMatch[1] : '';

      const keyMatch = match[1].match(/<Key[^>]*>([\s\S]*?)<\/Key>/i);
      const key = keyMatch
        ? {
            PropertyRef: Array.from(keyMatch[1].matchAll(/<PropertyRef[^>]*Name="([^"]*)"[^>]*\/?>/gi)).map(
              (m) => ({ Name: m[1] })
            ),
          }
        : undefined;

      const properties = this.parseProperties(match[1]);
      const navigationProperties = this.parseNavigationProperties(match[1]);

      entityTypes.push({
        Name: name,
        Key: key,
        Property: properties,
        NavigationProperty: navigationProperties.length > 0 ? navigationProperties : undefined,
      });
    }

    return entityTypes;
  }

  /**
   * Парсить ComplexTypes из содержимого Schema
   */
  private parseComplexTypes(schemaContent: string): IODataComplexType[] {
    const complexTypeMatches = schemaContent.matchAll(/<ComplexType[^>]*>([\s\S]*?)<\/ComplexType>/gi);
    const complexTypes: IODataComplexType[] = [];

    for (const match of complexTypeMatches) {
      const nameMatch = match[0].match(/Name="([^"]*)"/i);
      const name = nameMatch ? nameMatch[1] : '';

      const properties = this.parseProperties(match[1]);

      complexTypes.push({
        Name: name,
        Property: properties,
      });
    }

    return complexTypes;
  }

  /**
   * Парсить Properties
   */
  private parseProperties(content: string): IODataProperty[] {
    const propertyMatches = content.matchAll(/<Property[^>]*\/?>/gi);
    const properties: IODataProperty[] = [];

    for (const match of propertyMatches) {
      const nameMatch = match[0].match(/Name="([^"]*)"/i);
      const typeMatch = match[0].match(/Type="([^"]*)"/i);
      const nullableMatch = match[0].match(/Nullable="([^"]*)"/i);
      const maxLengthMatch = match[0].match(/MaxLength="([^"]*)"/i);
      const precisionMatch = match[0].match(/Precision="([^"]*)"/i);
      const scaleMatch = match[0].match(/Scale="([^"]*)"/i);

      properties.push({
        Name: nameMatch ? nameMatch[1] : '',
        Type: typeMatch ? typeMatch[1] : '',
        Nullable: nullableMatch ? nullableMatch[1] !== 'false' : true,
        MaxLength: maxLengthMatch ? parseInt(maxLengthMatch[1], 10) : undefined,
        Precision: precisionMatch ? parseInt(precisionMatch[1], 10) : undefined,
        Scale: scaleMatch ? parseInt(scaleMatch[1], 10) : undefined,
      });
    }

    return properties;
  }

  /**
   * Парсить NavigationProperties
   */
  private parseNavigationProperties(content: string): IODataNavigationProperty[] {
    const navMatches = content.matchAll(/<NavigationProperty[^>]*\/?>/gi);
    const navProperties: IODataNavigationProperty[] = [];

    for (const match of navMatches) {
      const nameMatch = match[0].match(/Name="([^"]*)"/i);
      const typeMatch = match[0].match(/Type="([^"]*)"/i);
      const partnerMatch = match[0].match(/Partner="([^"]*)"/i);

      navProperties.push({
        Name: nameMatch ? nameMatch[1] : '',
        Type: typeMatch ? typeMatch[1] : '',
        Partner: partnerMatch ? partnerMatch[1] : undefined,
      });
    }

    return navProperties;
  }

  /**
   * Парсить EntitySets
   */
  private parseEntitySets(schemaContent: string): IODataEntitySet[] {
    const containerMatch = schemaContent.match(/<EntityContainer[^>]*>([\s\S]*?)<\/EntityContainer>/i);
    if (!containerMatch) {
      return [];
    }

    const entitySetMatches = containerMatch[1].matchAll(/<EntitySet[^>]*\/?>/gi);
    const entitySets: IODataEntitySet[] = [];

    for (const match of entitySetMatches) {
      const nameMatch = match[0].match(/Name="([^"]*)"/i);
      const typeMatch = match[0].match(/EntityType="([^"]*)"/i);

      entitySets.push({
        Name: nameMatch ? nameMatch[1] : '',
        EntityType: typeMatch ? typeMatch[1] : '',
      });
    }

    return entitySets;
  }

}

