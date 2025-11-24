'use client'

import React from 'react'

type AalLogoIconProps = {
  className?: string
  color?: string
}

/**
 * Логотип ААЛ (Авиакомпания "Алроса")
 * Точное воспроизведение структуры из изображения
 */
export function AalLogoIcon({ className = 'w-8 h-8', color = '#FF8800' }: AalLogoIconProps) {
  // Размеры элементов
  const nodeRadius = 2.5
  const lineWidth = 3
  const targetOuterRadius = 4
  const targetInnerRadius = 2
  const targetStrokeWidth = 2.5

  return (
    <svg
      viewBox="0 0 200 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Первая форма - M-образная структура */}
      {/* Внешние вертикальные линии (ноги M) */}
      <line x1="20" y1="70" x2="20" y2="15" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      <line x1="60" y1="70" x2="60" y2="15" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Диагонали к центральной точке внизу */}
      <line x1="20" y1="15" x2="40" y2="70" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      <line x1="60" y1="15" x2="40" y2="70" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Диагонали к центральной точке вверху (перевёрнутый V) */}
      <line x1="20" y1="15" x2="40" y2="30" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      <line x1="60" y1="15" x2="40" y2="30" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Кружки в узлах первой формы */}
      <circle cx="20" cy="70" r={nodeRadius} fill={color} />
      <circle cx="20" cy="15" r={nodeRadius} fill={color} />
      <circle cx="40" cy="70" r={nodeRadius} fill={color} />
      <circle cx="40" cy="30" r={nodeRadius} fill={color} />
      <circle cx="60" cy="70" r={nodeRadius} fill={color} />
      <circle cx="60" cy="15" r={nodeRadius} fill={color} />
      
      {/* Вторая форма - M-образная с мишенью вверху */}
      {/* Внешние вертикальные линии (ноги M) */}
      <line x1="90" y1="70" x2="90" y2="15" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      <line x1="130" y1="70" x2="130" y2="15" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Диагонали к центральной точке внизу */}
      <line x1="90" y1="15" x2="110" y2="70" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      <line x1="130" y1="15" x2="110" y2="70" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Мишень вверху (два концентрических круга) */}
      <circle cx="110" cy="25" r={targetOuterRadius} fill="none" stroke={color} strokeWidth={targetStrokeWidth} />
      <circle cx="110" cy="25" r={targetInnerRadius} fill={color} />
      
      {/* Кружки в узлах второй формы */}
      <circle cx="90" cy="70" r={nodeRadius} fill={color} />
      <circle cx="90" cy="15" r={nodeRadius} fill={color} />
      <circle cx="110" cy="70" r={nodeRadius} fill={color} />
      <circle cx="130" cy="70" r={nodeRadius} fill={color} />
      <circle cx="130" cy="15" r={nodeRadius} fill={color} />
      
      {/* Третья форма - A-образная */}
      {/* Две диагонали, встречающиеся вверху */}
      <line x1="150" y1="70" x2="170" y2="15" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      <line x1="190" y1="70" x2="170" y2="15" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Горизонтальная линия внизу (основание) */}
      <line x1="150" y1="70" x2="190" y2="70" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Короткая вертикальная линия вниз от середины основания */}
      <line x1="170" y1="70" x2="170" y2="80" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />
      
      {/* Кружки в узлах третьей формы */}
      <circle cx="150" cy="70" r={nodeRadius} fill={color} />
      <circle cx="170" cy="15" r={nodeRadius} fill={color} />
      <circle cx="190" cy="70" r={nodeRadius} fill={color} />
      <circle cx="170" cy="80" r={nodeRadius} fill={color} />
    </svg>
  )
}

