'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RouteDetailsView } from '@/components/route-details/route-details-view';
import { RouteDetailsSkeleton } from '@/components/route-details/route-details-skeleton';
import { RouteDetailsError } from '@/components/route-details/route-details-error';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';

interface RouteDetailsData {
  from: {
    Ref_Key: string;
    Наименование?: string;
    Код?: string;
    Адрес?: string;
    Координаты?: string;
  };
  to: {
    Ref_Key: string;
    Наименование?: string;
    Код?: string;
    Адрес?: string;
    Координаты?: string;
  };
  date: string;
  routes: Array<{
    route: {
      Ref_Key: string;
      Наименование?: string;
      Код?: string;
      Description?: string;
    };
    segments: Array<{
      from: unknown;
      to: unknown;
      order: number;
    }>;
    schedule: unknown[];
    flights: Array<{
      Ref_Key: string;
      НомерРейса?: string;
      ВремяОтправления?: string;
      ВремяПрибытия?: string;
      Статус?: string;
      tariffs: unknown[];
      occupancy: unknown[];
      availableSeats: number;
    }>;
  }>;
}

export default function RoutePage() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<RouteDetailsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRouteDetails = async () => {
      const from = searchParams.get('from');
      const to = searchParams.get('to');
      const date = searchParams.get('date');

      if (!from || !to || !date) {
        setError('Не указаны обязательные параметры: from, to, date');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const { API_BASE_URL } = await import('@/shared/constants/api');
        
        const response = await fetch(
          `${API_BASE_URL}/routes/details?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${encodeURIComponent(date)}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error?.message || `Ошибка ${response.status}`
          );
        }

        const routeData = await response.json();
        setData(routeData);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Неизвестная ошибка';
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRouteDetails();
  }, [searchParams]);

  return (
    <div className="min-h-screen yakutia-pattern relative flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 md:py-8 relative z-10 max-w-[1300px] flex-1">
        {isLoading && <RouteDetailsSkeleton />}
        {error && <RouteDetailsError error={error} />}
        {!isLoading && !error && data && (
          <RouteDetailsView data={data} />
        )}
      </main>
      <Footer />
    </div>
  );
}

