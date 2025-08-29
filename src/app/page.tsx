'use client'

import dynamic from 'next/dynamic'

const PaperDriftGame = dynamic(() => import('@/components/PaperDriftGame'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Loading Game...</div>
})

export default function Home() {
  return <PaperDriftGame />
}