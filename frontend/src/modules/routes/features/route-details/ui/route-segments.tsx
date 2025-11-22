'use client';

interface Segment {
  from: {
    Наименование?: string;
    Код?: string;
    Адрес?: string;
  } | null;
  to: {
    Наименование?: string;
    Код?: string;
    Адрес?: string;
  } | null;
  order: number;
  transportType?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: number;
}

interface RouteSegmentsProps {
  segments: Segment[];
}

export function RouteSegments({ segments }: RouteSegmentsProps) {
  if (!segments || segments.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text-dark)' }}>
          Сегменты маршрута
        </h2>
        <p className="text-gray-600">Сегменты маршрута не найдены</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text-dark)' }}>
        Сегменты маршрута
      </h2>
      
      <div className="space-y-4">
        {segments.map((segment, index) => (
          <div
            key={index}
            className="border-l-4 border-blue-500 pl-4 py-2"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">
                {segment.order + 1}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold" style={{ color: 'var(--color-text-dark)' }}>
                    {segment.from?.Наименование || segment.from?.Код || 'Неизвестно'}
                  </div>
                  {segment.departureTime && (
                    <div className="text-sm text-gray-600 font-mono">
                      {segment.departureTime}
                    </div>
                  )}
                </div>
                <div className="text-gray-600 text-sm mt-1">
                  {segment.from?.Адрес}
                </div>
                
                <div className="my-2 flex items-center gap-2">
                  <div className="flex-1 h-px bg-gray-300"></div>
                  <div className="flex items-center gap-2">
                    {segment.transportType && (
                      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded" style={{ color: 'var(--color-text-dark)' }}>
                        {segment.transportType === 'airplane' ? '✈️ Самолёт' :
                         segment.transportType === 'bus' ? '🚌 Автобус' :
                         segment.transportType === 'train' ? '🚂 Поезд' :
                         segment.transportType === 'ferry' ? '⛴️ Паром' :
                         segment.transportType === 'taxi' ? '🚕 Такси' :
                         '🚌 Транспорт'}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">↓</span>
                  </div>
                  <div className="flex-1 h-px bg-gray-300"></div>
                </div>
                
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold" style={{ color: 'var(--color-text-dark)' }}>
                    {segment.to?.Наименование || segment.to?.Код || 'Неизвестно'}
                  </div>
                  {segment.arrivalTime && (
                    <div className="text-sm text-gray-600 font-mono">
                      {segment.arrivalTime}
                    </div>
                  )}
                </div>
                <div className="text-gray-600 text-sm mt-1">
                  {segment.to?.Адрес}
                  {segment.duration && (
                    <span className="ml-2 text-xs">
                      ({Math.floor(segment.duration / 60)}ч {segment.duration % 60}м)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

