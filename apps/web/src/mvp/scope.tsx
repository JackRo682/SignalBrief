'use client';
import {createContext,useContext} from 'react';
export const ResearchScope=createContext(false);
export function useResearchScope(){return useContext(ResearchScope);}
