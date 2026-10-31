import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import MobileAppearance from '../src/mobile/appearance';
import {defaults} from '../src/workspace/contracts';

const mock=vi.hoisted(()=>({workspace:vi.fn(),fetch:vi.fn()}));
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'synthetic-token'})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value:{...defaults,locale:'en'},loaded:true,busy:false,error:'',reload:vi.fn(),save:vi.fn(),text:(_ko:string,en:string)=>en})}));
vi.mock('../src/workspace/client',()=>({workspace:mock.workspace}));

beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('fetch',mock.fetch);
 mock.workspace.mockResolvedValue({items:[{id:'20000000-0000-4000-8000-000000000001',kind:'company',title:'Synthetic Company',summary:'',company_id:'20000000-0000-4000-8000-000000000001',company_name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'timestamp',category:'company',is_saved:false}],total:1,counts:{company:1},next_offset:null});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('previews supported company research without requesting or displaying market data',async()=>{
 render(<MobileAppearance/>);
 expect(await screen.findByText('Synthetic Company')).toBeVisible();
 expect(screen.getByRole('heading',{name:'Company research'})).toBeVisible();
 expect(screen.getByText('TEST',{selector:'small'})).toBeVisible();expect(screen.getByText('NASDAQ')).toBeVisible();
 expect(screen.getByText('Disclosures · company profiles · news')).toBeVisible();
 expect(mock.fetch).not.toHaveBeenCalled();
 expect(screen.queryByText('Quote unavailable')).not.toBeInTheDocument();
 expect(screen.queryByRole('img',{name:'Actual closing-price history'})).not.toBeInTheDocument();
 expect(screen.queryByRole('switch',{name:'Chart animation'})).not.toBeInTheDocument();
 expect(screen.getByRole('switch',{name:'Reduce motion'})).toBeEnabled();
});
