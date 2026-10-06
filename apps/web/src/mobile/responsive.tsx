'use client';
import {useSyncExternalStore, type ReactNode} from 'react';

const query='(max-width: 767px)';
function subscribe(onChange:()=>void){const media=window.matchMedia(query);media.addEventListener('change',onChange);return()=>media.removeEventListener('change',onChange);}
function snapshot(){return window.matchMedia(query).matches;}
function serverSnapshot(){return null;}
/** Only the visible view mounts, so hidden layouts never perform duplicate data requests or writes. */
export function useMobileViewport(){return useSyncExternalStore(subscribe,snapshot,serverSnapshot);}
export default function ResponsiveScreen({mobile,desktop}: {mobile:ReactNode;desktop:ReactNode}){
  const isMobile=useMobileViewport();
  if(isMobile===null)return null;
  return <>{isMobile?mobile:desktop}</>;
}
