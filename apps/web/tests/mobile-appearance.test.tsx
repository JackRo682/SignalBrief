import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import MobileAppearance from '../src/mobile/appearance';
import {defaults} from '../src/workspace/contracts';

const mock=vi.hoisted(()=>({workspace:vi.fn(),save:vi.fn(),text:(ko:string,en:string)=>ko||en}));
let value={...defaults},loaded=true;
vi.mock('../src/components/auth',()=>({useAuth:()=>({token:'synthetic-token'})}));
vi.mock('../src/workspace/preferences',()=>({usePrefs:()=>({value,loaded,busy:false,error:'',reload:vi.fn(),save:mock.save,text:mock.text})}));
vi.mock('../src/workspace/client',()=>({workspace:mock.workspace}));
vi.mock('../src/workspace/market',()=>({useQuotes:()=>({quotes:[],loading:false,reason:'display_permission_unavailable'})}));
beforeEach(()=>{vi.clearAllMocks();value={...defaults};loaded=true;mock.save.mockImplementation(async patch=>{value={...value,...patch};});mock.workspace.mockResolvedValue({items:[{id:'20000000-0000-4000-8000-000000000001',kind:'company',title:'Synthetic Company',summary:'',company_id:'20000000-0000-4000-8000-000000000001',company_name:'Synthetic Company',ticker:'TEST',market:'NASDAQ',source_url:null,published_at:null,publication_precision:'timestamp',category:'company',is_saved:false}],total:1,counts:{company:1},next_offset:null});});
afterEach(()=>cleanup());

describe('mobile appearance persists actual display settings',()=>{
 it('previews actual supported companies without reference-image prices',async()=>{
  render(<MobileAppearance/>);expect(await screen.findByText('Synthetic Company')).toBeVisible();expect(screen.getByText('시세 확인 전')).toBeVisible();expect(screen.queryByText('2,687.24')).not.toBeInTheDocument();expect(screen.queryByRole('img',{name:'실제 종가 추이'})).not.toBeInTheDocument();
 });
 it('applies a theme only after the preferences write succeeds',async()=>{
  render(<MobileAppearance/>);const dark=screen.getByRole('radio',{name:'다크'});fireEvent.click(dark);await waitFor(()=>expect(mock.save).toHaveBeenCalledWith({theme:'dark'}));await waitFor(()=>expect(dark).toHaveAttribute('aria-checked','true'));
 });
 it('keeps the persisted theme and exposes failed saves',async()=>{
  mock.save.mockRejectedValue(new Error('Synthetic version conflict'));render(<MobileAppearance/>);fireEvent.click(screen.getByRole('radio',{name:'다크'}));expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic version conflict');expect(screen.getByRole('radio',{name:'라이트'})).toHaveAttribute('aria-checked','true');
 });
 it('keeps slider focus and commits one pointer interaction after dragging',async()=>{
  render(<MobileAppearance/>);const slider=screen.getByRole('slider',{name:'글자 크기'});slider.focus();fireEvent.change(slider,{target:{value:'3'}});expect(slider).toHaveFocus();expect(mock.save).not.toHaveBeenCalled();fireEvent.pointerUp(slider);await waitFor(()=>expect(mock.save).toHaveBeenCalledExactlyOnceWith({font_scale:3}));expect(slider).toHaveAttribute('aria-valuetext','아주 크게');
 });
 it('supports keyboard text-size changes and restores the saved value after failure',async()=>{
  mock.save.mockRejectedValue(new Error('Synthetic save failure'));render(<MobileAppearance/>);const slider=screen.getByRole('slider',{name:'글자 크기'});fireEvent.change(slider,{target:{value:'2'}});fireEvent.keyUp(slider,{key:'ArrowRight'});await screen.findByRole('alert');await waitFor(()=>expect(slider).toHaveValue('1'));
 });
 it('respects reduced motion and keeps chart animation disabled while it is active',async()=>{
  render(<MobileAppearance/>);fireEvent.click(screen.getByRole('switch',{name:'움직임 최소화'}));await waitFor(()=>expect(mock.save).toHaveBeenCalledWith({reduced_motion:true}));const chart=screen.getByRole('switch',{name:'차트 애니메이션'});await waitFor(()=>expect(chart).toBeDisabled());expect(chart).toHaveAttribute('aria-checked','false');fireEvent.click(chart);expect(mock.save).toHaveBeenCalledTimes(1);
 });
 it('saves language and density as separate patches without replacing unrelated preferences',async()=>{
  render(<MobileAppearance/>);fireEvent.click(screen.getByRole('radio',{name:'컴팩트'}));await waitFor(()=>expect(mock.save).toHaveBeenCalledWith({ui_density:'compact'}));await waitFor(()=>expect(screen.getByRole('radio',{name:'영어'})).toBeEnabled());fireEvent.click(screen.getByRole('radio',{name:'영어'}));await waitFor(()=>expect(mock.save).toHaveBeenCalledWith({locale:'en'}));expect(value.timezone).toBe('Asia/Seoul');expect(value.ui_density).toBe('compact');
 });
 it('does not mutate preferences while account settings are still loading',()=>{
  loaded=false;render(<MobileAppearance/>);expect(screen.getByRole('radio',{name:'다크'})).toBeDisabled();expect(screen.getByRole('slider',{name:'글자 크기'})).toBeDisabled();fireEvent.click(screen.getByRole('radio',{name:'다크'}));expect(mock.save).not.toHaveBeenCalled();
 });
});
