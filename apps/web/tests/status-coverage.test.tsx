import '@testing-library/jest-dom/vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import Status from '../src/app/status/page';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(['verified','blocked','unknown'])('distinguishes DART collection %s from market display permission',async(status)=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.includes('auth-diagnostic')?{}:{checks:[{provider:'dart',status}],kis_display:false})));
 render(<Status/>);
 expect(await screen.findByText(status==='verified'?'OpenDART: 최근 수집 확인됨':status==='blocked'?'OpenDART: 최근 수집 실패 · 관리자 확인 필요':'OpenDART: 최근 수집 미확인')).toBeVisible();
 expect(screen.getByText('국내 시세 표시: 라이선스 확인 대기')).toBeVisible();
 expect(screen.queryByText('시장: US · 한국 데이터 보류')).toBeNull();
});
