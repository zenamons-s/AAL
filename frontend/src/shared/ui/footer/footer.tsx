'use client'

import { memo } from 'react'
import Link from 'next/link'
import { BrandLogo } from '@/shared/ui'

export const Footer = memo(function Footer() {
  const handleSupportClick = () => {
    // Открыть чат-бот через кнопку мамонтёнка
    const assistantButton = document.querySelector('[aria-label="Помощник мамонтёнок"]') as HTMLElement
    if (assistantButton) {
      assistantButton.click()
    }
  }

  return (
    <footer className="mt-auto border-t border-light bg-header-bg shadow-sm">
      <div className="container-main">
        {/* Brand Block - первая строка */}
        <div className="flex items-center justify-center py-sm">
          <BrandLogo link={false} className="justify-center mx-auto" />
        </div>
        {/* Ссылки - вторая строка */}
        <div className="flex items-center justify-center pb-sm gap-xl">
          <div className="flex items-center gap-sm">
            <Link
              href="/about"
              className="text-sm font-medium tracking-tight text-inverse hover-header-link transition-fast"
            >
              О нас
            </Link>
            <span className="text-sm text-inverse">•</span>
            <button
              type="button"
              onClick={handleSupportClick}
              aria-label="Открыть поддержку"
              className="text-sm font-medium tracking-tight text-inverse hover-header-link transition-fast"
            >
              Поддержка
            </button>
            <span className="text-sm text-inverse">•</span>
            <Link
              href="/license"
              className="text-sm font-medium tracking-tight text-inverse hover-header-link transition-fast"
            >
              Документы
            </Link>
            <span className="text-sm text-inverse">•</span>
            <span className="text-sm tracking-tight text-inverse font-medium">
              © 2025
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
})

