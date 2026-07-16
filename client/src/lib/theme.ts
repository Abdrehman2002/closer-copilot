export type ThemeChoice = 'light' | 'dark' | 'system'
const KEY = 'cc-theme'

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function getTheme(): ThemeChoice {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'
}

export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

export function setTheme(choice: ThemeChoice) {
  localStorage.setItem(KEY, choice)
  applyTheme(choice)
}

// call once at app start — safe to call again, idempotent
export function initTheme() {
  applyTheme(getTheme())
}
