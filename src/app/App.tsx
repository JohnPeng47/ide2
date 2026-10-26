import { ThemeToggle } from '../shared/theme/ThemeToggle';
import { lazy, Suspense, useState } from 'react';
import { createMappingServices } from './services';
import { MappingPocPage } from "../features/mapping/MappingPage";

const EvalsPage = lazy(() => import('../features/mapping/evals/EvalsPage').then(module => ({ default: module.EvalsPage })));
/** Unknown legacy entry paths continue to open Mapping. */
export function App() {
  const [services] = useState(createMappingServices);
  const evals = typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === `${import.meta.env.BASE_URL}evals`.replace(/\/$/, '');
  return <>{evals ? <Suspense fallback={<p>Loading Evals…</p>}><EvalsPage /></Suspense> : <MappingPocPage services={services} />}<ThemeToggle /></>;
}
