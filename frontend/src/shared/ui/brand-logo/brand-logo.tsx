'use client'

import Link from 'next/link'
import { MammothMascotIcon } from '@/shared/icons'

type BrandLogoProps = {
  link?: boolean
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Фирменный бренд-блок SaaS
 * 
 * Объединяет мамонтёнка и текст "SaaS"
 * Используется в Header и Footer
 * 
 * @param link - если true, логотип кликабельный и ведёт на "/"
 * @param className - дополнительные классы для обёртки
 * @param size - размер логотипа (sm/md/lg), по умолчанию md
 */
export function BrandLogo({ link = true, className = '', size = 'md' }: BrandLogoProps) {
  // Размеры иконок в зависимости от размера (пропорционально h-header ~48px)
  const iconSizes = {
    sm: 'w-6 h-6',   // 24px
    md: 'w-8 h-8',   // 32px (основной размер для h-header)
    lg: 'w-10 h-10', // 40px
  }

  // Размеры текста
  const textSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl',
  }

  const content = (
    <>
      <MammothMascotIcon 
        className={`${iconSizes[size]} text-inverse`} 
        color="var(--color-text-inverse)" 
      />

      <span className={`text-inverse ${textSizes[size]} font-semibold tracking-tight`}>
        SaaS
      </span>
    </>
  )

  const wrapperClassName = `flex items-center gap-sm select-none ${className}`

  if (link) {
    return (
      <Link 
        href="/" 
        className={`hover-header-link transition-fast ${wrapperClassName}`}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={wrapperClassName}>
      {content}
    </div>
  )
}

