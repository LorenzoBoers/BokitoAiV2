import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { PLATFORM_DEFAULT_LANGUAGE } from '../lib/api.config'
import commonEn from '../locales/en/common.json'
import navEn from '../locales/en/nav.json'
import profileEn from '../locales/en/profile.json'
import workspaceEn from '../locales/en/workspace.json'
import communicationEn from '../locales/en/communication.json'
import workspacesEn from '../locales/en/workspaces.json'
import governEn from '../locales/en/govern.json'
import tourEn from '../locales/en/tour.json'
import onboardingEn from '../locales/en/onboarding.json'
import calendarEn from '../locales/en/calendar.json'
import commonNl from '../locales/nl/common.json'
import navNl from '../locales/nl/nav.json'
import profileNl from '../locales/nl/profile.json'
import workspaceNl from '../locales/nl/workspace.json'
import communicationNl from '../locales/nl/communication.json'
import workspacesNl from '../locales/nl/workspaces.json'
import governNl from '../locales/nl/govern.json'
import tourNl from '../locales/nl/tour.json'
import onboardingNl from '../locales/nl/onboarding.json'
import calendarNl from '../locales/nl/calendar.json'

const resources = {
  en: {
    common: commonEn,
    nav: navEn,
    profile: profileEn,
    workspace: workspaceEn,
    communication: communicationEn,
    workspaces: workspacesEn,
    govern: governEn,
    tour: tourEn,
    onboarding: onboardingEn,
    calendar: calendarEn,
  },
  nl: {
    common: commonNl,
    nav: navNl,
    profile: profileNl,
    workspace: workspaceNl,
    communication: communicationNl,
    workspaces: workspacesNl,
    govern: governNl,
    tour: tourNl,
    onboarding: onboardingNl,
    calendar: calendarNl,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: PLATFORM_DEFAULT_LANGUAGE,
    supportedLngs: ['en', 'nl'],
    defaultNS: 'common',
    ns: ['common', 'nav', 'profile', 'workspace', 'communication', 'workspaces', 'govern', 'tour', 'onboarding', 'calendar'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'localStorage'],
      caches: ['localStorage'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'bokito-language',
    },
  })

export default i18n
