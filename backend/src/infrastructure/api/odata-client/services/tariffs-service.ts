/**
 * Сервис для работы с тарифами из OData API
 */

import { ODataClient } from '../odata-client';
import { IODataTariff, IODataFlightTariff } from '../types';

/**
 * Сервис для работы с тарифами
 */
export class TariffsService {
  constructor(private readonly odataClient: ODataClient) {}

  /**
   * Получить все действующие тарифы
   */
  async getActiveTariffs(): Promise<IODataTariff[]> {
    const today = new Date().toISOString().split('T')[0];
    const result = await this.odataClient.get<IODataTariff>(
      'Document_Тарифы',
      {
        $filter: `ДействуетС le '${today}' and ДействуетПо ge '${today}'`,
        $orderby: 'Наименование',
      }
    );
    return result.data;
  }

  /**
   * Получить тариф по ID
   */
  async getTariffById(tariffId: string): Promise<IODataTariff | null> {
    const result = await this.odataClient.get<IODataTariff>(
      `Document_Тарифы('${tariffId}')`
    );
    return result.data[0] || null;
  }

  /**
   * Получить тарифы из регистра сведений
   */
  async getCurrentTariffs(): Promise<IODataTariff[]> {
    const result = await this.odataClient.get<IODataTariff>(
      'InformationRegister_ДействующиеТарифы',
      {
        $orderby: 'Наименование',
      }
    );
    return result.data;
  }

  /**
   * Получить тарифы рейса
   */
  async getFlightTariffs(flightId: string): Promise<IODataFlightTariff[]> {
    const result = await this.odataClient.get<IODataFlightTariff>(
      'InformationRegister_ТарифыРейсов',
      {
        $filter: `Рейс_Key eq guid'${flightId}'`,
        $orderby: 'Цена',
      }
    );
    return result.data;
  }

  /**
   * Получить цену рейса по тарифу
   */
  async getFlightPrice(
    flightId: string,
    tariffId: string
  ): Promise<number | null> {
    const result = await this.odataClient.get<IODataFlightTariff>(
      'InformationRegister_ТарифыРейсов',
      {
        $filter: `Рейс_Key eq guid'${flightId}' and Тариф_Key eq guid'${tariffId}'`,
        $select: 'Цена',
      }
    );
    const firstItem = result.data[0];
    if (!firstItem) {
      return null;
    }
    const price = firstItem.Цена;
    return typeof price === 'number' ? price : null;
  }
}

