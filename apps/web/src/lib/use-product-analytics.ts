'use client';

import {useCallback, useLayoutEffect, useRef} from 'react';
import {useAuth} from '@/components/auth';
import {recordProductAction, type ProductEvent, type ProductParameters} from '@/acquisition/product-client';

export function useProductAnalytics() {
  const {token, me} = useAuth();
  const analyticsConsent = me?.analytics_consent === true;
  const isAdmin = me?.is_admin !== false;
  const isDemo = me?.demo_mode !== false;
  const current = useRef({token, analyticsConsent, isAdmin, isDemo});
  useLayoutEffect(() => { current.current = {token, analyticsConsent, isAdmin, isDemo}; },
    [token, analyticsConsent, isAdmin, isDemo]);
  const readAccount = useCallback(() => current.current, []);
  return useCallback((name: ProductEvent, parameters: ProductParameters) => {
    void recordProductAction(name, parameters, readAccount);
  }, [readAccount]);
}
