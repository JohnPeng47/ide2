import { createContext } from 'react';
import type { SourcePaneViewState } from './sourcePaneViewState';

export const SourcePaneViewStateContext = createContext<SourcePaneViewState | null>(null);
export const SourcePaneDocumentContext = createContext('');
export const SourcePaneDocumentActiveContext = createContext(true);
