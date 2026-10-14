import { ThemeToggle } from '../shared/theme/ThemeToggle';
import { useState } from 'react';
import { createMappingServices } from './services';
import { MappingPocPage } from "../features/mapping/MappingPage";

/** Every entry path opens the Mapping workspace, including old bookmarks. */
export function App() {
  const [services] = useState(createMappingServices);
  return <><MappingPocPage services={services} /><ThemeToggle /></>;
}
