/** Final presentation and keyboard refinements for the uploaded reference screens.
 * Illustrative preview contains no invented prices, account totals, or user counts.
 * All account and mutation handlers remain in the authenticated controller.
 */
import type { ReferenceContext } from './controller';
const pubPaths: Record<string, string> = {
 search:'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14M15 15l6 6',
 file:'M5 3h10l4 4v14H5ZM14 3v5h5M8 12h8M8 16h8',
 spark:'m13 2-9 12h7l-1 8 10-13h-7Z',
 user:'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M4 21v-3a8 8 0 0 1 16 0v3Z',
 home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
 star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
 pie:'M12 3v9h9M9 3.5A9 9 0 1 0 20.5 15M15 3.5A9 9 0 0 1 20.5 9H15Z',
 calendar:'M5 5h14v16H5ZM8 3v4M16 3v4M5 10h14',
 bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4',
 shield:'m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6ZM8 12l3 3 5-6'
};
const pubIcon=(name:string,size=20)=>`<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${pubPaths[name]??pubPaths.file}"/></svg>`;
const pubMark='<span class="brandMark"><i></i><i></i><i></i><i></i><i></i></span>';
export const googleMark='<svg aria-hidden="true" viewBox="0 0 24 24" width="23" height="23"><path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.38Z"/><path fill="#34a853" d="M12 22c2.7 0 4.96-.9 6.62-2.39l-3.24-2.52c-.9.6-2.06.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.6A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.41 13.94A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.94v-2.6H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.54l3.34-2.6Z"/><path fill="#ea4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.51l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.93 5.46l3.34 2.6C7.2 7.7 9.4 5.94 12 5.94Z"/></svg>';
export function polishReference(root:HTMLElement,screen:string,ctx:ReferenceContext):()=>void {
 const lifecycle=new AbortController();
 root.dataset.uiRelease='reference-screen-r2';
 if(screen!=='landing'){
  const nav=root.querySelector('.nav');
  if(nav){for(const [href,label,ico] of [['/explore','검색 / 탐색','search'],['/saved','저장 / 기록','star'],['/help','도움말 및 지원','shield']]){
   const a=document.createElement('a');a.href=href;a.innerHTML=`<span class="ico">${pubIcon(ico)}</span><span>${label}</span>`;nav.append(a);
  }}
 }

 root.querySelectorAll<HTMLInputElement>('#globalSearch,#stockSearch').forEach(input=>{
  if(!input.hasAttribute('aria-label'))input.setAttribute('aria-label',input.id==='globalSearch'?'기업 검색':'관심종목 검색');
 });
 // Spans inherited from the supplied templates already have Enter handlers.
 // Space should activate the same native operation, without duplicating clicks.
 root.addEventListener('keydown',event=>{
  if(event.key!==' '||!(event.target instanceof HTMLElement))return;
  const target=event.target;
  if(target.matches('[role="button"]:not(button),[role="link"]:not(a)')){event.preventDefault();target.click();}
 },{signal:lifecycle.signal});
 if(screen==='landing'){
  const google=root.querySelector('#googleLogin');
  if(google&&!ctx.user)google.innerHTML=`${googleMark}<span>Google로 시작하기</span>`;
  const find=root.querySelector('.landActions a[aria-label]');if(find)find.innerHTML=pubIcon('search',22);
  root.querySelectorAll('.featIcon').forEach((el,i)=>{el.innerHTML=pubIcon(['spark','file','user'][i],30);});
  const preview=root.querySelector('.productShot');
  if(preview){preview.classList.add('publicationPreview');preview.setAttribute('aria-label','브리핑 화면 구조 예시, 실시간 데이터 아님');
   preview.innerHTML=`<aside class="previewSidebar"><div class="previewBrand">${pubMark}<span>SignalBrief<small>근거 있는 투자, 더 나은 판단</small></span></div><nav aria-label="예시 화면 탐색">${[['home','오늘의 변화','/today'],['star','관심종목','/watchlist'],['pie','포트폴리오','/portfolio'],['file','타임라인','/timeline'],['calendar','캘린더','/calendar'],['bell','알림 센터','/alerts']].map(([i,label,url],n)=>`<a href="${ctx.user?url:'/login'}" ${n===0?'class="active"':''}>${pubIcon(i,14)}${label}</a>`).join('')}</nav></aside><div class="previewMain"><div class="previewSearch">${pubIcon('search',14)}<span>관심종목과 원문 근거를 함께 확인하세요</span><small>화면 예시</small></div><h3>오늘 내 포트폴리오에서 중요한 변화</h3><p class="previewCaption">무엇이 바뀌었고, 왜 중요한지, 어떤 근거가 있는지.</p><div class="previewBrief"><div class="previewCompany"><span class="previewCompanyIcon">${pubIcon('file',23)}</span><strong>선택한 기업</strong><small>등록한 관심종목</small><b>—</b><small>실시간 데이터 아님</small></div><div class="previewAnalysis"><strong>공시에서 무엇이 달라졌는지 확인하세요</strong><p>수집·검토가 완료된 근거가 여기에 연결됩니다.</p><div class="previewThree">${[['FACT','원문에서 확인한 사실'],['CHANGE','이전과 현재의 차이'],['WHY IT MATTERS','근거에 연결된 설명']].map(([label,value])=>`<div><b>${label}</b><span>${value}</span></div>`).join('')}</div><a class="previewStart" href="${ctx.user?'/today':'/signup'}">내 관심종목으로 시작 →</a></div></div></div>`;
  }
 }
 if(screen==='setup'){
  root.querySelectorAll('h2').forEach(h=>{
   const value=h.textContent??'';
   if(value.includes('관심종목 설정'))h.innerHTML=`<span class="publicationHeadingIcon">${pubIcon('star',27)}</span>관심종목 설정`;
   if(value.includes('포트폴리오 설정'))h.innerHTML=`<span class="publicationHeadingIcon">${pubIcon('pie',27)}</span>포트폴리오 설정`;
  });
 }
 if(screen==='onboarding'){
  const cancel=Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='취소하기');
  // Returning to /today would immediately redirect an unfinished user back here.
  // Cancel instead has an explicit, working account exit without saving changes.
  if(cancel){const exit=cancel.cloneNode(true) as HTMLButtonElement;cancel.replaceWith(exit);exit.addEventListener('click',async event=>{
   event.preventDefault();event.stopImmediatePropagation();
   if(!window.confirm('설정을 저장하지 않고 로그아웃할까요?'))return;
   exit.disabled=true;
   try{await ctx.auth('logout');ctx.go('/login');}catch{exit.disabled=false;const status=root.querySelector('#toast');if(status){status.textContent='로그아웃하지 못했습니다. 다시 시도해 주세요.';(status as HTMLElement).style.display='block';}}
  },{signal:lifecycle.signal,capture:true});}
 }
 return ()=>lifecycle.abort();
}
