import StatsCard from '../components/home/StatsCard'
import ActivityFeed from '../components/home/ActivityFeed'
import QuickActions from '../components/home/QuickActions'
import { stats } from '../data/mock-data'

export default function Home() {
  return (
    <div className="h-full flex flex-col overflow-hidden py-4">
      <div className="flex-1 overflow-y-auto">
        {/* Welcome */}
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-text-heading">
            Welkom terug, Lorenzo
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Hier is een overzicht van je Bokito platform.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {stats.map((stat) => (
            <StatsCard key={stat.label} stat={stat} />
          ))}
        </div>

        {/* Activity + Quick Actions */}
        <div className="grid grid-cols-[1fr_320px] gap-3 min-h-0" style={{ height: 'calc(100% - 170px)' }}>
          <ActivityFeed />
          <QuickActions />
        </div>
      </div>
    </div>
  )
}
