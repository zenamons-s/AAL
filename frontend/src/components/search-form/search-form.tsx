'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CityAutocomplete } from '@/components/city-autocomplete'
import { DatePicker } from '@/components/date-picker'
import { TripClassSelect } from './trip-class-select'
import { fetchCities } from '@/shared/utils/cities-api'

export function SearchForm() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    from: '',
    to: '',
    date: '',
    returnDate: '',
    passengers: '1',
    class: 'economy',
  })
  const [errors, setErrors] = useState<{
    from?: string
    to?: string
    date?: string
  }>({})
  const [availableCities, setAvailableCities] = useState<string[]>([])

  // Загрузка списка городов при монтировании компонента
  useEffect(() => {
    const loadCities = async () => {
      try {
        const cities = await fetchCities()
        setAvailableCities(cities)
      } catch (error) {
        console.error('Failed to load cities:', error)
      }
    }

    loadCities()
  }, [])

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {}

    if (!formData.from.trim()) {
      newErrors.from = 'Укажите город отправления'
    } else if (availableCities.length > 0 && !availableCities.includes(formData.from)) {
      newErrors.from = 'Выберите город из списка'
    }

    if (!formData.to.trim()) {
      newErrors.to = 'Укажите город назначения'
    } else if (availableCities.length > 0 && !availableCities.includes(formData.to)) {
      newErrors.to = 'Выберите город из списка'
    }

    if (formData.from === formData.to && formData.from) {
      newErrors.to = 'Город назначения должен отличаться от города отправления'
    }

    // Валидация даты (опционально)
    // Если дата указана, проверяем, что она не в прошлом
    if (formData.date) {
      const selectedDate = new Date(formData.date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (selectedDate < today) {
        newErrors.date = 'Дата не может быть в прошлом'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Используем актуальные значения из состояния
    setFormData((currentFormData) => {
      // Проверяем только обязательные поля: "Откуда" и "Куда"
      const fromValue = currentFormData.from.trim()
      const toValue = currentFormData.to.trim()

      if (!fromValue || !toValue) {
        setErrors({
          from: !fromValue ? 'Укажите город отправления' : undefined,
          to: !toValue ? 'Укажите город назначения' : undefined,
        })
        return currentFormData
      }

      // Нормализуем названия городов (убираем лишние пробелы)
      const normalizedFrom = fromValue
      const normalizedTo = toValue

      if (availableCities.length > 0 && !availableCities.includes(normalizedFrom)) {
        setErrors({ from: 'Выберите город из списка' })
        return currentFormData
      }

      if (availableCities.length > 0 && !availableCities.includes(normalizedTo)) {
        setErrors({ to: 'Выберите город из списка' })
        return currentFormData
      }

      if (normalizedFrom === normalizedTo) {
        setErrors({ to: 'Город назначения должен отличаться от города отправления' })
        return currentFormData
      }

      // Очищаем ошибки
      setErrors({})

      // Формируем параметры для URL
      // from и to - обязательные, date и passengers - опциональные
      const params = new URLSearchParams({
        from: normalizedFrom,
        to: normalizedTo,
      })

      // Добавляем дату, если она указана
      if (currentFormData.date) {
        params.set('date', currentFormData.date)
      }

      // Добавляем количество пассажиров, если указано и не равно 1
      if (currentFormData.passengers && currentFormData.passengers !== '1') {
        params.set('passengers', currentFormData.passengers)
      }

      // Переход на страницу результатов поиска
      router.push(`/routes?${params.toString()}`)

      return currentFormData
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const syntheticEvent = {
        preventDefault: () => {},
      } as React.FormEvent
      handleSubmit(syntheticEvent)
    }
  }

  const isFormValid = () => {
    // Кнопка активна только при заполнении "Откуда" и "Куда"
    // Поля "Пассажиры", "Класс поездки", "Дата" не блокируют кнопку
    if (!formData.from.trim() || !formData.to.trim()) {
      return false
    }
    
    // Если города еще загружаются, можно отправить форму
    if (availableCities.length === 0) {
      return formData.from !== formData.to
    }

    return (
      availableCities.includes(formData.from) &&
      availableCities.includes(formData.to) &&
      formData.from !== formData.to
    )
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value,
    })
    // Очищаем ошибку при изменении поля
    if (errors[name as keyof typeof errors]) {
      setErrors({
        ...errors,
        [name]: undefined,
      })
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="yakutia-card p-[18px] w-full relative"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        {/* Откуда */}
        <div>
          <CityAutocomplete
            id="from"
            name="from"
            label="Откуда"
            placeholder="Город отправления"
            value={formData.from}
            onChange={(value) => {
              const trimmedValue = value?.trim() || ''
              setFormData((prev) => ({ ...prev, from: trimmedValue }))
              if (errors.from) {
                setErrors((prev) => ({ ...prev, from: undefined }))
              }
            }}
            onKeyDown={handleKeyDown}
          />
          {errors.from && (
            <p className="text-sm mt-1" style={{ color: '#ff6b6b' }}>
              {errors.from}
            </p>
          )}
        </div>

        {/* Куда */}
        <div>
          <CityAutocomplete
            id="to"
            name="to"
            label="Куда"
            placeholder="Город назначения"
            value={formData.to}
            onChange={(value) => {
              const trimmedValue = value?.trim() || ''
              setFormData((prev) => ({ ...prev, to: trimmedValue }))
              if (errors.to) {
                setErrors((prev) => ({ ...prev, to: undefined }))
              }
            }}
            onKeyDown={handleKeyDown}
          />
          {errors.to && (
            <p className="text-sm mt-1" style={{ color: '#ff6b6b' }}>
              {errors.to}
            </p>
          )}
        </div>

        {/* Когда */}
        <div>
          <DatePicker
            id="date"
            name="date"
            label="Когда"
            value={formData.date}
            onChange={(value) => {
              setFormData((prev) => ({ ...prev, date: value }))
              if (errors.date) {
                setErrors((prev) => ({ ...prev, date: undefined }))
              }
            }}
            onKeyDown={handleKeyDown}
          />
          {errors.date && (
            <p className="text-sm mt-1" style={{ color: '#ff6b6b' }}>
              {errors.date}
            </p>
          )}
        </div>

        {/* Обратно */}
        <div>
          <DatePicker
            id="returnDate"
            name="returnDate"
            label="Обратно"
            value={formData.returnDate}
            onChange={(value) => {
              setFormData((prev) => ({ ...prev, returnDate: value }))
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Пассажиры */}
        <div className="space-y-2">
          <label htmlFor="passengers" className="block text-sm font-medium text-left" style={{ color: 'var(--color-text-light)' }}>
            Пассажиры
          </label>
          <div className="relative">
            <input
              type="number"
              id="passengers"
              name="passengers"
              value={formData.passengers}
              onChange={handleChange}
              min="1"
              max="9"
              className="w-full px-4 py-3 pr-12 rounded-yakutia focus:ring-2 focus:ring-white/20 outline-none yakutia-transition shadow-sm border"
              style={{ 
                color: 'var(--color-text-light)', 
                backgroundColor: 'var(--color-input-bg)', 
                borderColor: 'var(--color-input-border)',
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => {
                    const current = parseInt(prev.passengers) || 1
                    if (current < 9) {
                      return { ...prev, passengers: String(current + 1) }
                    }
                    return prev
                  })
                }}
                className="w-6 h-4 flex items-center justify-center rounded text-xs yakutia-transition hover:opacity-80"
                style={{ color: 'var(--color-text-light)' }}
                tabIndex={-1}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => {
                    const current = parseInt(prev.passengers) || 1
                    if (current > 1) {
                      return { ...prev, passengers: String(current - 1) }
                    }
                    return prev
                  })
                }}
                className="w-6 h-4 flex items-center justify-center rounded text-xs yakutia-transition hover:opacity-80"
                style={{ color: 'var(--color-text-light)' }}
                tabIndex={-1}
              >
                ▼
              </button>
            </div>
          </div>
        </div>

        {/* Класс поездки */}
        <div className="space-y-2 relative">
          <label htmlFor="class" className="block text-sm font-medium text-left" style={{ color: 'var(--color-text-light)' }}>
            Класс поездки
          </label>
          <TripClassSelect
            id="class"
            name="class"
            value={formData.class}
            onChange={(value) => {
              setFormData((prev) => ({ ...prev, class: value }))
            }}
          />
        </div>
      </div>

      {/* Кнопка поиска */}
      <div className="flex justify-center md:justify-start relative z-20">
        <button
          type="submit"
          disabled={!isFormValid()}
          className={`w-full md:w-auto px-12 py-4 text-lg font-bold text-white rounded-yakutia-lg shadow-lg yakutia-transition ${
            isFormValid()
              ? 'hover:shadow-xl hover:scale-[1.02] cursor-pointer'
              : 'opacity-50 cursor-not-allowed'
          }`}
          style={{
            backgroundColor: 'var(--color-primary)',
          }}
          onMouseEnter={(e) => {
            if (isFormValid()) {
              e.currentTarget.style.backgroundColor = 'var(--color-primary-hover)'
            }
          }}
          onMouseLeave={(e) => {
            if (isFormValid()) {
              e.currentTarget.style.backgroundColor = 'var(--color-primary)'
            }
          }}
        >
          Найти маршрут
        </button>
      </div>
    </form>
  )
}

