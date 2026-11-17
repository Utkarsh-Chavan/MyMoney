import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'mymoney-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly currentTheme = signal<Theme>(this.readStoredTheme());

  readonly theme = this.currentTheme.asReadonly();

  constructor() {
    this.applyTheme(this.currentTheme());
  }

  toggle(): void {
    this.setTheme(this.currentTheme() === 'light' ? 'dark' : 'light');
  }

  setTheme(theme: Theme): void {
    this.currentTheme.set(theme);
    this.applyTheme(theme);
    try {
      this.document.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.error('Unable to save the theme preference.', error);
    }
  }

  private readStoredTheme(): Theme {
    try {
      return this.document.defaultView?.localStorage.getItem(THEME_STORAGE_KEY) === 'dark'
        ? 'dark'
        : 'light';
    } catch (error) {
      console.error('Unable to read the saved theme preference.', error);
      return 'light';
    }
  }

  private applyTheme(theme: Theme): void {
    this.document.documentElement.dataset['theme'] = theme;
    this.document.documentElement.classList.toggle('dark', theme === 'dark');
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#101323' : '#f7f7fb',
    );
  }
}
