import { Component, inject, Injector, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import {
  LucideArrowLeftRight,
  LucideCalculator,
  LucideChartNoAxesCombined,
  LucideHandCoins,
  LucideLayoutDashboard,
  LucideMenu,
  LucideMoon,
  LucideReceipt,
  LucideSettings,
  LucideSun,
  LucideTarget,
  LucideWallet,
} from '@lucide/angular';
import { ThemeService } from './core/services/theme.service';
import type { ApplicationLockService } from './core/services/application-lock.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideArrowLeftRight,
    LucideCalculator,
    LucideChartNoAxesCombined,
    LucideHandCoins,
    LucideLayoutDashboard,
    LucideMenu,
    LucideMoon,
    LucideReceipt,
    LucideSettings,
    LucideSun,
    LucideTarget,
    LucideWallet,
  ],
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  protected readonly applicationLock = signal<ApplicationLockService | null>(null);
  protected readonly securityReady = signal(false);
  protected readonly securityStartupError = signal('');
  protected readonly lockPassphrase = signal('');
  protected readonly lockError = signal('');
  protected readonly lockBusy = signal(false);
  protected readonly themeService = inject(ThemeService);
  protected readonly isMobileNavOpen = signal(false);
  protected readonly currentPage = signal('Overview');

  constructor() {
    void this.initializeSecurity();
    this.updateCurrentPage();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.updateCurrentPage());
  }

  protected closeMobileNavigation(): void {
    this.isMobileNavOpen.set(false);
  }

  protected updateLockPassphrase(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.lockPassphrase.set(event.target.value);
  }

  protected async unlockApplication(event: Event): Promise<void> {
    event.preventDefault();
    const lockService = this.applicationLock();
    if (!lockService || this.lockBusy()) return;
    this.lockBusy.set(true);
    this.lockError.set('');
    const passphrase = this.lockPassphrase();
    this.lockPassphrase.set('');
    try {
      await lockService.unlock(passphrase);
    } catch (error) {
      this.lockError.set(errorMessage(error, 'Unable to unlock MyMoney.'));
    } finally {
      this.lockBusy.set(false);
    }
  }

  protected async retrySecurityInitialization(): Promise<void> {
    const current = this.applicationLock();
    if (current) {
      await current.initialize();
      this.securityStartupError.set(current.initializationError());
      return;
    }
    this.securityReady.set(false);
    await this.initializeSecurity();
  }

  private async initializeSecurity(): Promise<void> {
    this.securityStartupError.set('');
    try {
      const { ApplicationLockService: LockService } = await import('./core/services/application-lock.service');
      const lockService = this.injector.get(LockService);
      this.applicationLock.set(lockService);
      await lockService.initialize();
      this.securityStartupError.set(lockService.initializationError());
    } catch (error) {
      this.securityStartupError.set(errorMessage(error, 'Unable to initialize application security.'));
    } finally {
      this.securityReady.set(true);
    }
  }

  private updateCurrentPage(): void {
    const title = this.router.routerState.snapshot.root.firstChild?.title;
    this.currentPage.set(title?.split(' · ')[0] ?? 'Overview');
  }

}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
