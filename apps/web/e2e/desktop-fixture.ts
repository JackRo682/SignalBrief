import type {Page} from '@playwright/test';
import {answerSchema} from '../src/lib/contracts';
import {eventDetails,eventId,fixtureNow,mobileFixture,type MobileFixture} from './mobile-fixture';

// PC-specific state lives only in this test wrapper. The established mobile
// fixture and production response contracts are deliberately unchanged.
export const desktopQuestionId='80000000-0000-4000-8000-000000000951';
export const desktopQuestion='매출과 수익성의 원문 근거는 무엇인가요?';
export async function desktopFixture(page:Page):Promise<MobileFixture>{
 const fixture=await mobileFixture(page),detail=eventDetails.get(eventId)!;
 fixture.state.questions.push({id:desktopQuestionId,event_id:eventId,question:desktopQuestion,answer:answerSchema.parse({status:'answered',message:'게시된 실적 자료에서 매출과 이익 수치를 확인할 수 있습니다. 아래 인용문은 검토된 원문 구간이며, 미래 실적을 보장하는 전망으로 해석하지 않습니다.',evidence:detail.evidence.slice(0,3).map(entry=>({source_id:entry.document_id,quote:entry.quote,source_url:entry.source_url,location:entry.location})),run_id:null,mode:'extractive'}),created_at:fixtureNow});
 return fixture;
}
