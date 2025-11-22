'use client'

import { Suspense, useMemo, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Header, Footer, ErrorBoundary, DataModeBadge } from '@/shared/ui'
import { RouteRiskBadge, useRoutesSearch } from '@/modules/routes'
import { IBuiltRoute, IRiskAssessment, TransportType } from '@/modules/routes/domain'
import { safeLocalStorage } from '@/shared/utils/storage'
import { formatDuration, formatTime, formatDate, formatPrice } from '@/shared/utils/format'

interface Route extends IBuiltRoute {
  riskAssessment?: IRiskAssessment
}

/**
 * Компонент содержимого страницы результатов поиска маршрутов
 * 
 * Отображает результаты поиска маршрутов на основе параметров из URL.
 * Использует React Query для загрузки данных и кеширования.
 * 
 * @returns JSX элемент с результатами поиска маршрутов
 */
function RoutesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''
  const date = searchParams.get('date') || ''
  const passengers = searchParams.get('passengers') || '1'

  const { routes, alternatives, dataMode, dataQuality, isLoading, error, errorCode } = useRoutesSearch({
    from,
    to,
    date,
    passengers,
  })

  // Обработка случая, когда не указаны обязательные параметры
  const hasRequiredParams = Boolean(from && to)
  
  // Определяем тип ошибки и сообщение для пользователя
  const errorMessage = useMemo(() => {
    if (!hasRequiredParams) {
      return 'Не указаны параметры поиска'
    }
    
    if (!error) {
      return null
    }
    
    // Различаем типы ошибок по коду
    if (errorCode === 'STOPS_NOT_FOUND') {
      return `Города "${from}" или "${to}" не найдены в базе данных. Проверьте правильность написания.`
    }
    
    if (errorCode === 'GRAPH_OUT_OF_SYNC') {
      return 'Данные временно недоступны. Пожалуйста, попробуйте позже.'
    }
    
    if (errorCode === 'ROUTES_NOT_FOUND') {
      // Для ROUTES_NOT_FOUND не показываем ошибку, показываем заглушку "маршруты не найдены"
      return null
    }
    
    // Общая ошибка
    return error.message || 'Произошла ошибка при поиске маршрутов'
  }, [error, errorCode, hasRequiredParams, from, to])

  // Мемоизация функции выбора маршрута
  const handleSelectRoute = useCallback((route: Route) => {
    safeLocalStorage.setItem(`route-${route.routeId}`, JSON.stringify({
      route,
      riskAssessment: route.riskAssessment,
    }))
    router.push(`/routes/details?routeId=${route.routeId}`)
  }, [router])

  // Мемоизация функции получения метки типа транспорта
  const getTransportTypeLabel = useCallback((type: string): string => {
    const labels: Record<string, string> = {
      'airplane': 'Самолёт',
      'bus': 'Автобус',
      'train': 'Поезд',
      'ferry': 'Паром',
      'taxi': 'Такси',
      'AIR': 'Самолёт',
      'BUS': 'Автобус',
      'TRAIN': 'Поезд',
      'FERRY': 'Паром',
      'TAXI': 'Такси',
    }
    return labels[type] || type
  }, [])

  return (
    <div className="min-h-screen yakutia-pattern relative flex flex-col">
      <Header />

      <main className="container mx-auto px-4 py-6 md:py-8 relative z-10 max-w-[1300px] flex-1" aria-label="Результаты поиска маршрутов">
        {/* Заголовок */}
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-3 leading-tight text-balance text-dark">
            Результаты поиска маршрутов
          </h1>
          {from && to && (
            <div className="text-lg md:text-xl text-dark">
              <span className="font-semibold">{from}</span>
              <span className="mx-2">→</span>
              <span className="font-semibold">{to}</span>
              {date && (
                <>
                  <span className="mx-2">•</span>
                  <span>{formatDate(date)}</span>
                </>
              )}
              {passengers && passengers !== '1' && (
                <>
                  <span className="mx-2">•</span>
                  <span>{passengers} {passengers === '1' ? 'пассажир' : 'пассажиров'}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Индикатор загрузки */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-lg text-dark">Поиск маршрутов...</p>
          </div>
        )}

        {/* Ошибка (только для критичных ошибок, не для ROUTES_NOT_FOUND) */}
        {errorMessage && !isLoading && errorCode !== 'ROUTES_NOT_FOUND' && (
          <div className="yakutia-card p-6 text-center">
            <p className="text-lg text-dark">{errorMessage}</p>
          </div>
        )}

        {/* Результаты поиска */}
        {!isLoading && (!errorMessage || errorCode === 'ROUTES_NOT_FOUND') && (
          <>
            {/* Индикатор режима данных */}
            {dataMode && (
              <div className="mb-6 flex justify-center">
                <DataModeBadge dataMode={dataMode} dataQuality={dataQuality} />
              </div>
            )}

            {/* Основные маршруты */}
            {routes && routes.length > 0 ? (
              <div className="space-y-4 mb-8">
                <h2 className="text-2xl font-semibold mb-4 text-dark">
                  Найденные маршруты
                </h2>
                {routes.map((route) => {
                  // Безопасная проверка наличия всех необходимых полей
                  if (!route || !route.routeId || !route.fromCity || !route.toCity) {
                    return null
                  }
                  
                  return (
                    <div key={route.routeId} className="yakutia-card p-[18px] yakutia-transition">
                      <div className="flex flex-col gap-4">
                        {/* Заголовок маршрута */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xl font-bold text-dark">
                                {route.fromCity}
                              </span>
                              <span className="text-lg text-primary">→</span>
                              <span className="text-xl font-bold text-dark">
                                {route.toCity}
                              </span>
                            </div>
                            <div className="text-sm text-dark">
                              {route.departureTime && formatTime(route.departureTime)} - {route.arrivalTime && formatTime(route.arrivalTime)}
                              {route.transferCount !== undefined && route.transferCount > 0 && (
                                <span className="ml-2">
                                  • {route.transferCount} {route.transferCount === 1 ? 'пересадка' : 'пересадки'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="flex items-center justify-end gap-3 mb-2">
                              {route.totalPrice !== undefined && (
                                <div className="text-2xl font-bold text-primary">
                                  {formatPrice(route.totalPrice)}
                                </div>
                              )}
                              {route.riskAssessment && route.riskAssessment.riskScore && (
                                <RouteRiskBadge riskScore={route.riskAssessment.riskScore} compact />
                              )}
                            </div>
                            {route.totalDuration !== undefined && (
                              <div className="text-sm text-dark">
                                {formatDuration(route.totalDuration)}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Сегменты маршрута */}
                        {route.segments && Array.isArray(route.segments) && route.segments.length > 0 && (
                          <div className="border-t pt-4 border-card">
                            <div className="space-y-3">
                              {route.segments.map((segment, index) => {
                                // Безопасная проверка наличия segment
                                if (!segment) {
                                  return null
                                }
                                
                                // Если segment.segment отсутствует, используем значения напрямую из segment
                                const transportType = segment.segment?.transportType || TransportType.BUS
                                const segmentDuration = segment.duration ?? 0
                                const segmentPrice = segment.price ?? 0
                                
                                return (
                                  <div key={index} className="flex items-center gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold bg-primary text-white">
                                      {index + 1}
                                    </div>
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-medium text-dark">
                                          {getTransportTypeLabel(String(transportType))}
                                        </span>
                                        {segment.departureTime && segment.arrivalTime && (
                                          <span className="text-xs text-dark">
                                            {formatTime(segment.departureTime)} - {formatTime(segment.arrivalTime)}
                                          </span>
                                        )}
                                      </div>
                                      {(segmentDuration > 0 || segmentPrice > 0) && (
                                        <div className="text-xs text-dark">
                                          {segmentDuration > 0 && formatDuration(segmentDuration)}
                                          {segmentDuration > 0 && segmentPrice > 0 && ' • '}
                                          {segmentPrice > 0 && formatPrice(segmentPrice)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Кнопка выбора */}
                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => handleSelectRoute(route)}
                            aria-label={`Выбрать маршрут из ${route.fromCity} в ${route.toCity}`}
                            className="px-6 py-2 rounded-yakutia yakutia-transition font-semibold bg-primary hover:bg-primary-hover text-white"
                          >
                            Выбрать маршрут
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="yakutia-card p-12 text-center">
                <p className="text-xl font-semibold mb-2 text-dark">
                  {errorCode === 'ROUTES_NOT_FOUND' 
                    ? `Маршрутов между ${from} и ${to}${date ? ` на ${formatDate(date)}` : ''} не найдено`
                    : 'Маршруты не найдены'
                  }
                </p>
                <p className="text-base text-dark">
                  Попробуйте изменить параметры поиска или выберите другую дату
                </p>
              </div>
            )}

            {/* Альтернативные маршруты */}
            {alternatives && Array.isArray(alternatives) && alternatives.length > 0 && (
              <div className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold mb-4 text-dark">
                  Альтернативные маршруты
                </h2>
                {alternatives.map((route) => {
                  // Безопасная проверка наличия всех необходимых полей
                  if (!route || !route.routeId || !route.fromCity || !route.toCity) {
                    return null
                  }
                  
                  return (
                    <div key={route.routeId} className="yakutia-card p-[18px] yakutia-transition">
                      <div className="flex flex-col gap-4">
                        {/* Заголовок маршрута */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xl font-bold text-dark">
                                {route.fromCity}
                              </span>
                              <span className="text-lg text-primary">→</span>
                              <span className="text-xl font-bold text-dark">
                                {route.toCity}
                              </span>
                            </div>
                            <div className="text-sm text-dark">
                              {route.departureTime && formatTime(route.departureTime)} - {route.arrivalTime && formatTime(route.arrivalTime)}
                              {route.transferCount !== undefined && route.transferCount > 0 && (
                                <span className="ml-2">
                                  • {route.transferCount} {route.transferCount === 1 ? 'пересадка' : 'пересадки'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="flex items-center justify-end gap-3 mb-2">
                              {route.totalPrice !== undefined && (
                                <div className="text-2xl font-bold text-primary">
                                  {formatPrice(route.totalPrice)}
                                </div>
                              )}
                              {route.riskAssessment && route.riskAssessment.riskScore && (
                                <RouteRiskBadge riskScore={route.riskAssessment.riskScore} compact />
                              )}
                            </div>
                            {route.totalDuration !== undefined && (
                              <div className="text-sm text-dark">
                                {formatDuration(route.totalDuration)}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Сегменты маршрута */}
                        {route.segments && Array.isArray(route.segments) && route.segments.length > 0 && (
                          <div className="border-t pt-4 border-card">
                            <div className="space-y-3">
                              {route.segments.map((segment, index) => {
                                // Безопасная проверка наличия segment
                                if (!segment) {
                                  return null
                                }
                                
                                // Если segment.segment отсутствует, используем значения напрямую из segment
                                const transportType = segment.segment?.transportType || TransportType.BUS
                                const segmentDuration = segment.duration ?? 0
                                const segmentPrice = segment.price ?? 0
                                
                                return (
                                  <div key={index} className="flex items-center gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold bg-primary text-white">
                                      {index + 1}
                                    </div>
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-medium text-dark">
                                          {getTransportTypeLabel(String(transportType))}
                                        </span>
                                        {segment.departureTime && segment.arrivalTime && (
                                          <span className="text-xs text-dark">
                                            {formatTime(segment.departureTime)} - {formatTime(segment.arrivalTime)}
                                          </span>
                                        )}
                                      </div>
                                      {(segmentDuration > 0 || segmentPrice > 0) && (
                                        <div className="text-xs text-dark">
                                          {segmentDuration > 0 && formatDuration(segmentDuration)}
                                          {segmentDuration > 0 && segmentPrice > 0 && ' • '}
                                          {segmentPrice > 0 && formatPrice(segmentPrice)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Кнопка выбора */}
                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => handleSelectRoute(route)}
                            aria-label={`Выбрать маршрут из ${route.fromCity} в ${route.toCity}`}
                            className="px-6 py-2 rounded-yakutia yakutia-transition font-semibold bg-primary hover:bg-primary-hover text-white"
                          >
                            Выбрать маршрут
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default function RoutesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen yakutia-pattern relative flex flex-col">
        <Header />
        <main className="container mx-auto px-4 py-6 md:py-8 relative z-10 max-w-[1300px] flex-1">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-lg text-dark">Загрузка...</p>
          </div>
        </main>
        <Footer />
      </div>
    }>
      <ErrorBoundary>
        <RoutesContent />
      </ErrorBoundary>
    </Suspense>
  )
}

