'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

import { Skeleton } from '@/components/ui/primitives';

const loading = () => <Skeleton className="h-[600px] w-full" />;

/** Lesson bodies by slug, each loaded only when its lesson opens. */
export const LESSON_BODIES: Record<string, ComponentType> = {
  'time-value-of-money': dynamic(() => import('./foundations').then((m) => m.TimeValueOfMoney), { loading }),
  'three-statements': dynamic(() => import('./foundations').then((m) => m.ThreeStatements), { loading }),
  'enterprise-value': dynamic(() => import('./foundations').then((m) => m.EnterpriseValue), { loading }),
  dcf: dynamic(() => import('./valuation').then((m) => m.Dcf), { loading }),
  wacc: dynamic(() => import('./valuation').then((m) => m.Wacc), { loading }),
  'reverse-dcf': dynamic(() => import('./valuation').then((m) => m.ReverseDcf), { loading }),
  comps: dynamic(() => import('./valuation').then((m) => m.Comps), { loading }),
  'risk-return': dynamic(() => import('./risk').then((m) => m.RiskReturn), { loading }),
  'sharpe-ratio': dynamic(() => import('./risk').then((m) => m.SharpeRatio), { loading }),
  diversification: dynamic(() => import('./risk').then((m) => m.Diversification), { loading }),
  'monte-carlo': dynamic(() => import('./risk').then((m) => m.MonteCarlo), { loading }),
  'value-at-risk': dynamic(() => import('./risk').then((m) => m.ValueAtRisk), { loading }),
  'm-and-a': dynamic(() => import('./deals').then((m) => m.MergersAndAcquisitions), { loading }),
  lbo: dynamic(() => import('./deals').then((m) => m.Lbo), { loading }),
  bonds: dynamic(() => import('./deals').then((m) => m.Bonds), { loading }),
  'investment-thesis': dynamic(() => import('./research').then((m) => m.InvestmentThesis), { loading }),
  'stock-pitch': dynamic(() => import('./research').then((m) => m.StockPitch), { loading }),
};
