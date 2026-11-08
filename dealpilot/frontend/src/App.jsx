import { useMemo } from 'react'
import { useRoute } from './lib/route'
import { AppContext, useDealPilot } from './lib/useDealPilot'
import Header from './components/Header'
import BusyBar from './components/BusyBar'
import Banner from './components/Banner'
import Tasks from './views/Tasks'
import Pipeline from './views/Pipeline'
import Deal from './views/Deal'
import Performance from './views/Performance'
import Alerts from './views/Alerts'
import Fraud from './views/Fraud'
import Simulation from './views/Simulation'

const VIEWS = { tasks: Tasks, pipeline: Pipeline, deal: Deal, performance: Performance, alerts: Alerts, fraud: Fraud, simulation: Simulation }

export default function App() {
  const dp = useDealPilot()
  const route = useRoute()
  const value = useMemo(() => ({ ...dp, route }), [dp, route])
  const View = VIEWS[route.name] || Tasks
  return (
    <AppContext.Provider value={value}>
      <div className="min-h-screen bg-page text-body">
        <Header route={route} />
        <BusyBar busy={dp.busy} />
        <Banner />
        {dp.state ? <View key={route.name === 'deal' ? `deal:${route.folder}` : route.name} /> : (
          <p data-testid="loading" className="mx-auto max-w-[1360px] px-8 py-16 text-[16px] text-muted">Loading the latest deals…</p>
        )}
      </div>
    </AppContext.Provider>
  )
}
