import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {FilingAnalysis} from '../src/components/filing-analysis';
afterEach(cleanup);
const value={filing_id:'test',status:'needs_review',result:{claims:[{text:'Synthetic supported fact',quote:'Synthetic original quotation.'}],validation:'quote_substring_and_numeric_check',omitted_claim_count:1}};
describe('human filing review',()=>{
 it('requires a reason and explicit source review before publication',()=>{
  const onReview=vi.fn().mockResolvedValue(undefined);render(<FilingAnalysis value={value} admin busy={false} onReview={onReview}/>);
  const approve=screen.getByRole('button',{name:'검토 완료 · 공개'});expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText('검토 사유'),{target:{value:'Compared the synthetic source.'}});expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));expect(approve).toBeEnabled();fireEvent.click(approve);expect(onReview).toHaveBeenCalledWith('approved','Compared the synthetic source.');
  expect(screen.getByRole('status')).toHaveTextContent('후보 1개를 제외');
 });
 it('does not expose publication actions to ordinary users',()=>{render(<FilingAnalysis value={value} admin={false} busy={false} onReview={vi.fn()}/>);expect(screen.queryByRole('button')).toBeNull();});
 it('never enables approval for unvalidated evidence',()=>{render(<FilingAnalysis value={{...value,result:{...value.result,validation:'failed'}}} admin busy={false} onReview={vi.fn()}/>);fireEvent.change(screen.getByLabelText('검토 사유'),{target:{value:'Synthetic invalid draft'}});fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'검토 완료 · 공개'})).toBeDisabled();});
});
