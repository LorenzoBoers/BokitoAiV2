import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Bot,
  Brain,
  CalendarClock,
  Gauge,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { appScopedGet } from '../../lib/api'
import { appRoutes } from '../../api/routes/app.routes'
import { getTourState, patchTourState } from '../../lib/tour-api'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import { TOUR_STEPS, TOUR_VERSION, WELCOME_PILLARS } from './tour-steps'

type TourPhase = 'idle' | 'welcome' | 'steps' | 'finish'

type TourContextValue = {
  /** Open the tour from the beginning (welcome screen). */
  start: () => void
  active: boolean
}

const TourContext = createContext<TourContextValue>({ start: () => undefined, active: false })

// eslint-disable-next-line react-refresh/only-export-components
export function useTour(): TourContextValue {
  return useContext(TourContext)
}

const PILLAR_ICONS: Record<(typeof WELCOME_PILLARS)[number], typeof Bot> = {
  communication: MessageSquare,
  ai: Bot,
  automations: CalendarClock,
  cockpit: Gauge,
  control: ShieldCheck,
}

type Rect = { top: number; left: number; width: number; height: number }

function measureTarget(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  // Hidden anchors (mobile drawer closed, collapsed groups) fall back to a
  // centered card instead of spotlighting an invisible point.
  if (rect.width < 4 || rect.height < 4) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation('tour')
  const [phase, setPhase] = useState<TourPhase>('idle')
  const [stepIndex, setStepIndex] = useState(0)
  const autoChecked = useRef(false)

  // Auto-start for brand-new users: no persisted tour state yet and the
  // workspace onboarding checklist is still incomplete.
  useEffect(() => {
    if (!token || autoChecked.current) return
    autoChecked.current = true
    let cancelled = false
    void (async () => {
      try {
        const tour = await getTourState(token)
        const seen =
          (tour.intro_done || tour.dismissed || tour.completed) &&
          (tour.version ?? 0) >= TOUR_VERSION
        if (seen) return
        const onboarding = await appScopedGet<{ completed: boolean }>(
          appRoutes.onboarding.status,
          token,
        )
        if (!cancelled && !onboarding.completed) setPhase('welcome')
      } catch {
        // Never block the app on tour bookkeeping.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const persist = useCallback(
    (state: { completed?: boolean; dismissed?: boolean }) => {
      if (!token) return
      void patchTourState(token, {
        intro_done: true,
        version: TOUR_VERSION,
        ...state,
      }).catch(() => undefined)
    },
    [token],
  )

  const start = useCallback(() => {
    setStepIndex(0)
    setPhase('welcome')
  }, [])

  const dismiss = useCallback(() => {
    persist({ dismissed: true })
    setPhase('idle')
  }, [persist])

  const beginSteps = useCallback(() => {
    setStepIndex(0)
    const first = TOUR_STEPS[0]
    if (first?.route) navigate(first.route)
    setPhase('steps')
  }, [navigate])

  const goToStep = useCallback(
    (index: number) => {
      if (index < 0) return
      if (index >= TOUR_STEPS.length) {
        setPhase('finish')
        return
      }
      const step = TOUR_STEPS[index]
      if (step.route) navigate(step.route)
      setStepIndex(index)
    },
    [navigate],
  )

  const finishExplore = useCallback(() => {
    persist({ completed: true })
    setPhase('idle')
    navigate('/settings/setup')
  }, [persist, navigate])

  const finishWithAssistant = useCallback(() => {
    persist({ completed: true })
    setPhase('idle')
    const prompt = t('setupPrompt', { lng: i18n.resolvedLanguage })
    const dest = talkToAssistantPath(prompt, { kind: 'company' })
    navigate(`${dest}${dest.includes('?') ? '&' : '?'}autosend=1`)
  }, [persist, navigate, t, i18n.resolvedLanguage])

  const finishWithSetupGuide = useCallback(() => {
    persist({ completed: true })
    setPhase('idle')
    navigate('/settings/setup')
  }, [persist, navigate])

  const value = useMemo<TourContextValue>(
    () => ({ start, active: phase !== 'idle' }),
    [start, phase],
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      {phase === 'welcome' ? (
        <WelcomeScreen onStart={beginSteps} onSkip={dismiss} />
      ) : null}
      {phase === 'steps' ? (
        <StepOverlay
          stepIndex={stepIndex}
          onNext={() => goToStep(stepIndex + 1)}
          onBack={() => goToStep(stepIndex - 1)}
          onSkip={dismiss}
        />
      ) : null}
      {phase === 'finish' ? (
        <FinishScreen
          onAssistant={finishWithAssistant}
          onSetupGuide={finishWithSetupGuide}
          onExplore={finishExplore}
        />
      ) : null}
    </TourContext.Provider>
  )
}

/** Shared keyframes for the tour surfaces (self-contained, no global CSS). */
function TourStyles() {
  return (
    <style>{`
      @keyframes bk-tour-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes bk-tour-pop { from { opacity: 0; transform: translateY(10px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
      @keyframes bk-tour-pulse {
        0% { transform: scale(1); opacity: 0.55 }
        70% { transform: scale(1.12); opacity: 0 }
        100% { transform: scale(1.12); opacity: 0 }
      }
      .bk-tour-fade { animation: bk-tour-fade 240ms ease-out both }
      .bk-tour-pop { animation: bk-tour-pop 320ms cubic-bezier(0.21, 1.02, 0.73, 1) both }
      .bk-tour-pulse { animation: bk-tour-pulse 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite }
    `}</style>
  )
}

function WelcomeScreen({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const { t } = useTranslation('tour')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
      if (e.key === 'Enter') onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip, onStart])

  return createPortal(
    <div className="bk-tour-fade fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
      <TourStyles />
      <div className="bk-tour-pop relative w-full max-w-[600px] overflow-hidden rounded-2xl border border-border/60 bg-bg-surface shadow-overlay">
        {/* Accent halo */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 left-1/2 h-56 w-[420px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--accent, #6366f1), transparent)' }}
        />
        <button
          type="button"
          onClick={onSkip}
          aria-label={t('welcome.skip')}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
        >
          <X size={15} />
        </button>

        <div className="relative px-7 pb-7 pt-8">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
              <Sparkles size={20} />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              {t('welcome.eyebrow')}
            </p>
            <h2 className="mt-1 text-[20px] font-semibold text-text-heading">
              {t('welcome.title')}
            </h2>
            <p className="mx-auto mt-1.5 max-w-[440px] text-[13px] leading-relaxed text-text-secondary">
              {t('welcome.subtitle')}
            </p>
          </div>

          <div className="space-y-1.5">
            {WELCOME_PILLARS.map((pillar, idx) => {
              const Icon = PILLAR_ICONS[pillar]
              const violet = pillar === 'ai'
              return (
                <div
                  key={pillar}
                  className="bk-tour-pop flex items-center gap-3 rounded-xl border border-border/50 bg-bg-elevated/40 px-3.5 py-2.5"
                  style={{ animationDelay: `${80 + idx * 60}ms` }}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      violet
                        ? 'bg-violet-500/12 text-violet-500 dark:text-violet-300'
                        : 'bg-accent/10 text-accent'
                    }`}
                  >
                    {violet ? <Brain size={15} /> : <Icon size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-text-heading">
                      {t(`welcome.pillars.${pillar}.title`)}
                    </span>
                    <span className="block text-[11.5px] leading-snug text-text-secondary">
                      {t(`welcome.pillars.${pillar}.body`)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="mt-6 flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg px-3.5 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('welcome.skip')}
            </button>
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-fg shadow-card transition-colors hover:bg-accent-hover"
            >
              {t('welcome.start')}
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function StepOverlay({
  stepIndex,
  onNext,
  onBack,
  onSkip,
}: {
  stepIndex: number
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}) {
  const { t } = useTranslation('tour')
  const step = TOUR_STEPS[stepIndex]
  const [rect, setRect] = useState<Rect | null>(null)

  // Measure (with retries: the anchor may appear a few frames after a route
  // change) and keep tracking on resize/scroll/layout shifts.
  useEffect(() => {
    let raf = 0
    let tries = 0
    let interval = 0

    const measure = () => setRect(measureTarget(step.target))
    const tryMeasure = () => {
      const found = measureTarget(step.target)
      if (found || tries > 20) {
        setRect(found)
        return
      }
      tries += 1
      raf = window.requestAnimationFrame(tryMeasure)
    }
    tryMeasure()

    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    interval = window.setInterval(measure, 400)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.clearInterval(interval)
    }
  }, [step.target])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
      if (e.key === 'ArrowRight' || e.key === 'Enter') onNext()
      if (e.key === 'ArrowLeft') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip, onNext, onBack])

  const pad = 6
  const spot = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null

  // Card position: right of the anchor when it fits, else centered.
  const cardWidth = 330
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const fitsRight = spot ? spot.left + spot.width + cardWidth + 32 < viewportW : false
  const cardStyle: React.CSSProperties =
    spot && fitsRight
      ? {
          position: 'fixed',
          left: spot.left + spot.width + 18,
          top: Math.min(Math.max(spot.top - 8, 16), viewportH - 260),
          width: cardWidth,
        }
      : {
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: Math.min(cardWidth + 30, viewportW - 32),
        }

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <TourStyles />
      {/* Click shield: the tour owns the screen while active. */}
      <div className="absolute inset-0" onClick={onNext} />
      {spot ? (
        <>
          {/* Spotlight cutout: dims everything except the anchor, glides between steps. */}
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-xl"
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
              boxShadow: '0 0 0 9999px rgba(3, 7, 18, 0.62)',
              transition: 'all 320ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
          {/* Pointing effect: static ring + soft pulse. */}
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-xl border-2 border-accent"
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
              transition: 'all 320ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
          <div
            aria-hidden
            className="bk-tour-pulse pointer-events-none absolute rounded-xl border-2 border-accent"
            style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          />
        </>
      ) : (
        <div aria-hidden className="bk-tour-fade absolute inset-0 bg-black/60" />
      )}

      <div
        key={step.id}
        role="dialog"
        aria-label={t(`steps.${step.id}.title`)}
        className="bk-tour-pop rounded-2xl border border-border/60 bg-bg-surface p-4 shadow-overlay"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-accent">
            {t('progress', { current: stepIndex + 1, total: TOUR_STEPS.length })}
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="text-[11px] text-text-muted transition-colors hover:text-text-primary"
          >
            {t('skipTour')}
          </button>
        </div>
        <h3 className="text-[14.5px] font-semibold text-text-heading">
          {t(`steps.${step.id}.title`)}
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
          {t(`steps.${step.id}.body`)}
        </p>
        <div className="mt-3.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {TOUR_STEPS.map((s, idx) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${
                  idx === stepIndex ? 'w-4 bg-accent' : 'w-1.5 bg-border'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={onBack}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
              >
                {t('back')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
            >
              {t('next')}
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function FinishScreen({
  onAssistant,
  onSetupGuide,
  onExplore,
}: {
  onAssistant: () => void
  onSetupGuide: () => void
  onExplore: () => void
}) {
  const { t } = useTranslation('tour')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExplore()
      if (e.key === 'Enter') onAssistant()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExplore, onAssistant])

  return createPortal(
    <div className="bk-tour-fade fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
      <TourStyles />
      <div className="bk-tour-pop relative w-full max-w-[480px] overflow-hidden rounded-2xl border border-border/60 bg-bg-surface px-7 pb-7 pt-8 text-center shadow-overlay">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[360px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--accent, #6366f1), transparent)' }}
        />
        <div className="relative">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <Bot size={20} />
          </div>
          <h2 className="text-[18px] font-semibold text-text-heading">{t('finish.title')}</h2>
          <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-text-secondary">
            {t('finish.body')}
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onAssistant}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-fg shadow-card transition-colors hover:bg-accent-hover"
            >
              <Sparkles size={13} />
              {t('finish.cta')}
            </button>
            <button
              type="button"
              onClick={onSetupGuide}
              className="rounded-lg border border-border/60 px-3.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('finish.setupGuide')}
            </button>
            <button
              type="button"
              onClick={onExplore}
              className="rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
            >
              {t('finish.later')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
