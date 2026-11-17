import { Component, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { LucideArrowLeft, LucideSparkles } from '@lucide/angular';

@Component({
  selector: 'app-feature-placeholder',
  imports: [RouterLink, LucideArrowLeft, LucideSparkles],
  template: `
    <section class="placeholder-page">
      <a class="back-link" routerLink="/">
        <svg lucideArrowLeft aria-hidden="true"></svg>
        Back to overview
      </a>
      <div class="placeholder-card">
        <div class="placeholder-icon"><svg lucideSparkles aria-hidden="true"></svg></div>
        <p class="eyebrow">MYMONEY WORKSPACE</p>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
        <span class="phase-badge">Foundation is ready</span>
      </div>
    </section>
  `,
})
export class FeaturePlaceholderComponent {
  private readonly route = inject(ActivatedRoute);

  readonly title = this.route.snapshot.data['title'] as string;
  readonly description = this.route.snapshot.data['description'] as string;
}
