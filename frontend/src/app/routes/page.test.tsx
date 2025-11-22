/**
 * Тесты для компонента RoutesContent
 * 
 * Проверяет корректную обработку различных состояний:
 * - Загрузка
 * - Успешный ответ с маршрутами
 * - Пустой список маршрутов (ROUTES_NOT_FOUND)
 * - Ошибки (STOPS_NOT_FOUND, GRAPH_OUT_OF_SYNC)
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import RoutesPage from './page'

// Мокаем next/navigation
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(() => ({
    push: mockPush,
  })),
}))

// Мокаем useRoutesSearch
const mockUseRoutesSearch = jest.fn()
jest.mock('@/modules/routes', () => ({
  useRoutesSearch: (...args: any[]) => mockUseRoutesSearch(...args),
  RouteRiskBadge: ({ riskScore }: { riskScore: { value: number } }) => (
    <div data-testid="risk-badge">{riskScore.value}</div>
  ),
}))

// Мокаем UI компоненты
jest.mock('@/shared/ui', () => ({
  Header: () => <header data-testid="header">Header</header>,
  Footer: () => <footer data-testid="footer">Footer</footer>,
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DataModeBadge: () => <div data-testid="data-mode-badge">Data Mode</div>,
}))

// Мокаем утилиты
jest.mock('@/shared/utils/storage', () => ({
  safeLocalStorage: {
    setItem: jest.fn(),
  },
}))

jest.mock('@/shared/utils/format', () => ({
  formatDuration: (ms: number) => `${Math.floor(ms / 60)}ч`,
  formatTime: (time: string) => time,
  formatDate: (date: string) => date,
  formatPrice: (price: number) => `${price}₽`,
}))

describe('RoutesContent', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    ;(useSearchParams as jest.Mock).mockReturnValue({
      get: (key: string) => {
        const params: Record<string, string> = {
          from: 'Якутск',
          to: 'Олёкминск',
          date: '2025-11-22',
          passengers: '1',
        }
        return params[key] || ''
      },
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should render loading state', () => {
    mockUseRoutesSearch.mockReturnValue({
      routes: [],
      alternatives: [],
      isLoading: true,
      error: null,
      errorCode: undefined,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RoutesPage />
      </QueryClientProvider>
    )

    expect(screen.getByText('Поиск маршрутов...')).toBeInTheDocument()
  })

  it('should render "routes not found" message when ROUTES_NOT_FOUND', () => {
    mockUseRoutesSearch.mockReturnValue({
      routes: [],
      alternatives: [],
      isLoading: false,
      error: null,
      errorCode: 'ROUTES_NOT_FOUND',
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RoutesPage />
      </QueryClientProvider>
    )

    expect(
      screen.getByText(/Маршрутов между Якутск и Олёкминск на 2025-11-22 не найдено/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Попробуйте изменить параметры поиска/)).toBeInTheDocument()
    
    // Не должно быть попыток рендерить карточки маршрутов
    expect(screen.queryByText('Найденные маршруты')).not.toBeInTheDocument()
  })

  it('should render "routes not found" message when routes array is empty', () => {
    mockUseRoutesSearch.mockReturnValue({
      routes: [],
      alternatives: [],
      isLoading: false,
      error: null,
      errorCode: undefined,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RoutesPage />
      </QueryClientProvider>
    )

    expect(screen.getByText('Маршруты не найдены')).toBeInTheDocument()
    expect(screen.getByText(/Попробуйте изменить параметры поиска/)).toBeInTheDocument()
    
    // Не должно быть попыток рендерить карточки маршрутов
    expect(screen.queryByText('Найденные маршруты')).not.toBeInTheDocument()
  })

  it('should render STOPS_NOT_FOUND error message', () => {
    mockUseRoutesSearch.mockReturnValue({
      routes: [],
      alternatives: [],
      isLoading: false,
      error: new Error('No stops found for city: Алдан'),
      errorCode: 'STOPS_NOT_FOUND',
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RoutesPage />
      </QueryClientProvider>
    )

    expect(
      screen.getByText(/Города ".*" или ".*" не найдены в базе данных/)
    ).toBeInTheDocument()
    
    // Не должно быть попыток рендерить карточки маршрутов
    expect(screen.queryByText('Найденные маршруты')).not.toBeInTheDocument()
  })

  it('should render GRAPH_OUT_OF_SYNC error message', () => {
    mockUseRoutesSearch.mockReturnValue({
      routes: [],
      alternatives: [],
      isLoading: false,
      error: new Error('Graph is out of sync'),
      errorCode: 'GRAPH_OUT_OF_SYNC',
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RoutesPage />
      </QueryClientProvider>
    )

    expect(
      screen.getByText('Данные временно недоступны. Пожалуйста, попробуйте позже.')
    ).toBeInTheDocument()
    
    // Не должно быть попыток рендерить карточки маршрутов
    expect(screen.queryByText('Найденные маршруты')).not.toBeInTheDocument()
  })

  it('should render routes when they exist', () => {
    const mockRoute = {
      routeId: 'route-1',
      fromCity: 'Якутск',
      toCity: 'Олёкминск',
      departureTime: '2025-11-22T08:00:00Z',
      arrivalTime: '2025-11-22T12:00:00Z',
      totalPrice: 1800,
      totalDuration: 240,
      transferCount: 0,
      segments: [
        {
          segment: {
            segmentId: 'seg-1',
            transportType: 'BUS',
            fromStopId: 'stop-1',
            toStopId: 'stop-2',
            routeId: 'route-1',
          },
          departureTime: '2025-11-22T08:00:00Z',
          arrivalTime: '2025-11-22T12:00:00Z',
          duration: 240,
          price: 1800,
        },
      ],
    }

    mockUseRoutesSearch.mockReturnValue({
      routes: [mockRoute],
      alternatives: [],
      isLoading: false,
      error: null,
      errorCode: undefined,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RoutesPage />
      </QueryClientProvider>
    )

    expect(screen.getByText('Найденные маршруты')).toBeInTheDocument()
    // Используем getAllByText, так как названия городов могут встречаться несколько раз
    expect(screen.getAllByText('Якутск').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Олёкминск').length).toBeGreaterThan(0)
    expect(screen.getByText('Автобус')).toBeInTheDocument()
  })

  it('should not crash when segment.segment is undefined', () => {
    const mockRouteWithInvalidSegment = {
      routeId: 'route-1',
      fromCity: 'Якутск',
      toCity: 'Олёкминск',
      departureTime: '2025-11-22T08:00:00Z',
      arrivalTime: '2025-11-22T12:00:00Z',
      totalPrice: 1800,
      totalDuration: 240,
      transferCount: 0,
      segments: [
        {
          // segment.segment отсутствует
          departureTime: '2025-11-22T08:00:00Z',
          arrivalTime: '2025-11-22T12:00:00Z',
          duration: 240,
          price: 1800,
        },
      ],
    }

    mockUseRoutesSearch.mockReturnValue({
      routes: [mockRouteWithInvalidSegment],
      alternatives: [],
      isLoading: false,
      error: null,
      errorCode: undefined,
    })

    // Компонент не должен упасть
    expect(() => {
      render(
        <QueryClientProvider client={queryClient}>
          <RoutesPage />
        </QueryClientProvider>
      )
    }).not.toThrow()

    // Сегмент с невалидными данными не должен отображаться
    expect(screen.queryByText('Автобус')).not.toBeInTheDocument()
  })

  it('should not crash when route is missing required fields', () => {
    const invalidRoute = {
      routeId: 'route-1',
      // fromCity и toCity отсутствуют
    }

    mockUseRoutesSearch.mockReturnValue({
      routes: [invalidRoute],
      alternatives: [],
      isLoading: false,
      error: null,
      errorCode: undefined,
    })

    // Компонент не должен упасть
    expect(() => {
      render(
        <QueryClientProvider client={queryClient}>
          <RoutesPage />
        </QueryClientProvider>
      )
    }).not.toThrow()
  })
})

