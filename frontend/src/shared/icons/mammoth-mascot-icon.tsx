'use client'

import React from 'react'

type MammothMascotIconProps = {
  className?: string
  color?: string
}

/**
 * Векторная плоская версия мамонтёнка как маскота приложения
 * Упрощённый cartoon-flat стиль с плавными контурами
 */
export function MammothMascotIcon({ className = 'w-24 h-24', color = 'currentColor' }: MammothMascotIconProps) {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Тень */}
      <ellipse
        cx="100"
        cy="185"
        rx="45"
        ry="8"
        fill="#000000"
        opacity="0.15"
      />
      
      {/* Тело мамонтёнка */}
      <path
        d="M 100 120 Q 140 100 150 80 Q 155 70 150 60 Q 145 50 135 55 Q 130 58 125 65 L 120 70 Q 115 75 110 80 L 105 85 Q 100 90 95 85 L 90 80 Q 85 75 80 70 L 75 65 Q 70 58 65 55 Q 55 50 50 60 Q 45 70 50 80 Q 60 100 100 120 Z"
        fill={color}
        fillOpacity="0.9"
      />
      
      {/* Голова */}
      <ellipse
        cx="100"
        cy="75"
        rx="50"
        ry="45"
        fill={color}
      />
      
      {/* Уши */}
      <ellipse
        cx="70"
        cy="60"
        rx="18"
        ry="25"
        fill={color}
        fillOpacity="0.7"
        transform="rotate(-25 70 60)"
      />
      <ellipse
        cx="130"
        cy="60"
        rx="18"
        ry="25"
        fill={color}
        fillOpacity="0.7"
        transform="rotate(25 130 60)"
      />
      
      {/* Внутренняя часть ушей */}
      <ellipse
        cx="70"
        cy="60"
        rx="10"
        ry="15"
        fill={color}
        fillOpacity="0.9"
        transform="rotate(-25 70 60)"
      />
      <ellipse
        cx="130"
        cy="60"
        rx="10"
        ry="15"
        fill={color}
        fillOpacity="0.9"
        transform="rotate(25 130 60)"
      />
      
      {/* Хобот */}
      <path
        d="M 100 95 Q 100 110 95 120 Q 90 130 85 135 Q 80 140 75 142 Q 70 144 65 142 Q 60 140 58 135 Q 55 130 55 125 Q 55 120 58 115 Q 60 110 65 108 Q 70 106 75 108 Q 80 110 85 115 Q 90 120 95 125 Q 100 130 100 135"
        fill={color}
        fillOpacity="0.7"
      />
      
      {/* Кончик хобота */}
      <ellipse
        cx="60"
        cy="140"
        rx="8"
        ry="5"
        fill={color}
        fillOpacity="0.9"
      />
      
      {/* Бивни */}
      <path
        d="M 75 100 Q 70 105 68 110 Q 66 115 68 120 Q 70 125 75 123 Q 80 121 82 116 Q 84 111 82 106 Q 80 101 75 100 Z"
        fill="#F5F5DC"
      />
      <path
        d="M 125 100 Q 130 105 132 110 Q 134 115 132 120 Q 130 125 125 123 Q 120 121 118 116 Q 116 111 118 106 Q 120 101 125 100 Z"
        fill="#F5F5DC"
      />
      
      {/* Глаза */}
      <circle
        cx="85"
        cy="70"
        r="8"
        fill="#FFFFFF"
      />
      <circle
        cx="115"
        cy="70"
        r="8"
        fill="#FFFFFF"
      />
      <circle
        cx="87"
        cy="72"
        r="5"
        fill="#1A1A1A"
      />
      <circle
        cx="117"
        cy="72"
        r="5"
        fill="#1A1A1A"
      />
      <circle
        cx="88"
        cy="73"
        r="2"
        fill="#FFFFFF"
      />
      <circle
        cx="118"
        cy="73"
        r="2"
        fill="#FFFFFF"
      />
      
      {/* Нос */}
      <ellipse
        cx="100"
        cy="85"
        rx="6"
        ry="4"
        fill={color}
        fillOpacity="0.7"
      />
      
      {/* Шерсть на голове */}
      <path
        d="M 60 50 Q 65 45 70 50 Q 75 45 80 50 Q 85 45 90 50 Q 95 45 100 50 Q 105 45 110 50 Q 115 45 120 50 Q 125 45 130 50 Q 135 45 140 50"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        strokeOpacity="0.6"
      />
      
      {/* Шерсть на теле */}
      <path
        d="M 110 100 Q 115 95 120 100 Q 125 95 130 100"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        strokeOpacity="0.6"
      />
      <path
        d="M 80 100 Q 85 95 90 100 Q 95 95 100 100"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        strokeOpacity="0.6"
      />
      
      {/* Ноги */}
      <ellipse
        cx="85"
        cy="150"
        rx="12"
        ry="20"
        fill={color}
        fillOpacity="0.7"
      />
      <ellipse
        cx="115"
        cy="150"
        rx="12"
        ry="20"
        fill={color}
        fillOpacity="0.7"
      />
      
      {/* Копыта */}
      <ellipse
        cx="85"
        cy="165"
        rx="10"
        ry="6"
        fill={color}
        fillOpacity="0.5"
      />
      <ellipse
        cx="115"
        cy="165"
        rx="10"
        ry="6"
        fill={color}
        fillOpacity="0.5"
      />
    </svg>
  )
}

