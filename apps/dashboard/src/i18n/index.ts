import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import commonEn from '../locales/en/common.json'
import navEn from '../locales/en/nav.json'
import profileEn from '../locales/en/profile.json'
import workspaceEn from '../locales/en/workspace.json'
import communicationEn from '../locales/en/communication.json'
import workspacesEn from '../locales/en/workspaces.json'
import agendaEn from '../locales/en/agenda.json'
import aiosEn from '../locales/en/aios.json'
import commonNl from '../locales/nl/common.json'
import navNl from '../locales/nl/nav.json'
import profileNl from '../locales/nl/profile.json'
import workspaceNl from '../locales/nl/workspace.json'
import communicationNl from '../locales/nl/communication.json'
import workspacesNl from '../locales/nl/workspaces.json'

const resources = {
  en: {
    common: commonEn,
    nav: navEn,
    profile: profileEn,
    workspace: workspaceEn,
    communication: communicationEn,
    workspaces: workspacesEn,
    agenda: agendaEn,
    aios: aiosEn,
  },
  nl: {
    common: commonNl,
    nav: navNl,
    profile: profileNl,
    workspace: workspaceNl,
    communication: communicationNl,
    workspaces: workspacesNl,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'nl'],
    defaultNS: 'common',
    ns: ['common', 'nav', 'profile', 'workspace', 'communication', 'workspaces', 'agenda', 'aios'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'bokito-language',
    },
  })

export default i18n
