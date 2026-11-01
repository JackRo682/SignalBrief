/** Editorial descriptions verified against the listed first-party pages.
 * These are business areas, not inferred accounting/reporting segments.
 * Tickers are resolved from the authenticated canonical company resource. */
export type BusinessProfile={
 description:[string,string];products:[string[],string[]];areas:[string[],string[]];
 website:string;sources:{url:string;label:string;snapshot?:{sha256:string;capturedAt:string;format:'html'|'retrieved_text';location:string}}[];verifiedOn:string;coverage?:[string,string];
};
export const companyBusinessProfiles:Readonly<Record<string,BusinessProfile>>={
 '035420':{
  description:['NAVER는 온라인 검색과 광고를 기반으로 커머스·콘텐츠·클라우드·핀테크 서비스를 제공합니다. 공식 회사 소개는 검색 포털, 스마트스토어, 네이버페이와 자체 AI 기술 HyperCLOVA X를 주요 서비스·기술로 설명합니다.','NAVER provides online search and advertising alongside commerce, content, cloud and fintech services. Its corporate overview describes the search portal, Smart Store, NAVER Pay and its HyperCLOVA X AI technology.'],
  products:[['네이버 검색·광고','스마트스토어·쇼핑라이브','네이버페이','콘텐츠·커뮤니티 서비스','HyperCLOVA X·클라우드'],['NAVER search and advertising','Smart Store and Shopping Live','NAVER Pay','Content and community services','HyperCLOVA X and cloud']],
  areas:[['검색 및 광고','커머스','콘텐츠','클라우드 및 AI','핀테크'],['Search and advertising','Commerce','Content','Cloud and AI','Fintech']],
  website:'https://www.navercorp.com/',sources:[{url:'https://www.navercorp.com/company/about',label:'NAVER — 공식 회사 소개',snapshot:{sha256:'45d679064a24e882daf17b71d03a18f1dca011e30b3e66099e8678edbc77e747',capturedAt:'2026-11-01T06:45:27.661700Z',format:'html',location:'소개 / SEARCH / COMMERCE / FINTECH / 주요 사업'}}],verifiedOn:'2026-11-01',
 },
 '006260':{
  description:['LS는 전기·전자·소재·에너지 분야 계열사의 사업을 관리하는 지주회사입니다. 공식 그룹 소개는 주요 계열사의 전력 케이블, 전력기기와 자동화, 동 소재 및 에너지 사업을 설명합니다.','LS Corp. is a holding company whose affiliates operate in electricity, electronics, materials and energy. The group overview describes affiliates in power cables, electrical equipment and automation, copper materials, and energy.'],
  products:[['지주회사 경영·사업관리','전력 케이블(계열사)','전력기기·자동화(계열사)','동 소재·에너지(계열사)'],['Holding-company business management','Power cables (affiliates)','Electrical equipment and automation (affiliates)','Copper materials and energy (affiliates)']],
  areas:[['지주사업','전기·전자','소재','에너지'],['Holding-company operations','Electricity and electronics','Materials','Energy']],
  website:'https://www.lsholdings.co.kr/',sources:[{url:'https://lsholdings.co.kr/en/about/status',label:'LS — Official group and holding-company overview',snapshot:{sha256:'4b606fef04ec4311ac4d75f1c49fed307f13831ae94fe4179db5568e8fc079e8',capturedAt:'2026-11-01T06:47:57.385012Z',format:'retrieved_text',location:'Management: group overview and CEO message, retrieved lines 65–68 and 89–95'}}],verifiedOn:'2026-11-01',
  coverage:['계열사 제품과 그룹 사업 영역을 함께 소개합니다. 지주회사 LS가 모든 제품을 직접 생산한다는 뜻은 아닙니다.','The profile includes affiliates’ products and group business areas. It does not imply that the holding company directly manufactures every product.'],
 },
 MU:{
  description:['Micron Technology는 DRAM·NAND·NOR 기반의 메모리와 스토리지 제품을 개발하는 반도체 기업입니다. 공식 회사·제품 소개는 AI와 데이터센터, 모바일, 자동차 및 산업용 기기에 사용되는 메모리·저장 솔루션을 설명합니다.','Micron Technology develops semiconductor memory and storage using DRAM, NAND and NOR technologies. Its official corporate and product overview covers solutions for AI and data centers, mobile devices, automotive systems and industrial equipment.'],
  products:[['DRAM·HBM 메모리','NAND·NOR 플래시','SSD·스토리지 솔루션'],['DRAM and HBM memory','NAND and NOR flash','SSDs and storage solutions']],
  areas:[['메모리 반도체','스토리지','데이터센터 및 AI','모바일·자동차·산업용 솔루션'],['Memory semiconductors','Storage','Data centers and AI','Mobile, automotive and industrial solutions']],
  website:'https://www.micron.com/',sources:[{url:'https://www.micron.com/about/company/corporate-profile',label:'Micron — Official corporate profile',snapshot:{sha256:'817c028f8000200ffb880dd1ee352b09a1f58285ba857233e68ce8178c773891',capturedAt:'2026-11-01T06:45:29.376865Z',format:'html',location:'Who we are; Products; Market & Industries'}}],verifiedOn:'2026-11-01',
 },
 AAPL:{
  description:['Apple은 하드웨어, 소프트웨어와 서비스를 함께 제공하는 기술 기업입니다. 공식 기업용 제품 안내는 Mac, iPhone, iPad, Apple Vision Pro와 기기 관리·지원 서비스를 소개합니다.','Apple combines hardware, software and services. Its official business product overview covers Mac, iPhone, iPad, Apple Vision Pro, and device management and support services.'],
  products:[['Mac','iPhone','iPad','Apple Vision Pro','Apple Business / AppleCare'],['Mac','iPhone','iPad','Apple Vision Pro','Apple Business / AppleCare']],
  areas:[['컴퓨팅 기기','모바일 기기','기기 관리 및 지원'],['Computing devices','Mobile devices','Device management and support']],
  website:'https://www.apple.com/',sources:[{url:'https://www.apple.com/business/',label:'Apple — Apple at Work'}],verifiedOn:'2026-10-31',
 },
 MSFT:{
  description:['Microsoft는 기업과 개인을 위한 소프트웨어, 클라우드, AI 및 기기를 제공합니다. 공식 기업 소개와 제품 목록에는 Microsoft 365, Azure, Copilot, Windows, Dynamics 365, Surface와 Xbox가 포함됩니다.','Microsoft provides software, cloud services, AI and devices for organizations and individuals. Its official company and product overview lists Microsoft 365, Azure, Copilot, Windows, Dynamics 365, Surface and Xbox.'],
  products:[['Microsoft 365 / Teams','Azure','Copilot','Windows / Surface','Dynamics 365 / Power Platform','Xbox'],['Microsoft 365 / Teams','Azure','Copilot','Windows / Surface','Dynamics 365 / Power Platform','Xbox']],
  areas:[['업무용 소프트웨어','클라우드 및 AI','운영체제와 기기','게임'],['Productivity software','Cloud and AI','Operating systems and devices','Gaming']],
  website:'https://www.microsoft.com/',sources:[{url:'https://www.microsoft.com/en-us/about',label:'Microsoft — About Microsoft'}],verifiedOn:'2026-10-31',
 },
 NVDA:{
  description:['NVIDIA는 가속 컴퓨팅을 중심으로 반도체, 시스템과 소프트웨어를 개발합니다. 공식 회사 소개는 AI 인프라, RTX 그래픽, Omniverse 기반 산업 디지털화, 자동차와 헬스케어 활용을 설명합니다.','NVIDIA develops chips, systems and software for accelerated computing. Its official company overview describes AI infrastructure, RTX graphics, Omniverse industrial digitalization, and applications in automotive and healthcare.'],
  products:[['AI 컴퓨팅 반도체와 시스템','NVIDIA RTX','NVIDIA Omniverse','AI 소프트웨어와 서비스'],['AI computing chips and systems','NVIDIA RTX','NVIDIA Omniverse','AI software and services']],
  areas:[['AI 및 가속 컴퓨팅','그래픽','산업 디지털화','자동차 및 헬스케어'],['AI and accelerated computing','Graphics','Industrial digitalization','Automotive and healthcare']],
  website:'https://www.nvidia.com/',sources:[{url:'https://www.nvidia.com/en-us/about-nvidia/',label:'NVIDIA — About NVIDIA'}],verifiedOn:'2026-10-31',
 },
 TSLA:{
  description:['Tesla는 전기자동차와 에너지 생성·저장 제품을 개발하고 생산합니다. 공식 투자자 안내와 제품 사이트는 차량과 태양광·에너지 저장 사업을 함께 소개합니다.','Tesla develops and manufactures electric vehicles and energy generation and storage products. Its official investor and product sites describe both vehicles and clean-energy products.'],
  products:[['전기자동차','태양광 제품','에너지 저장 제품'],['Electric vehicles','Solar products','Energy storage products']],
  areas:[['자동차','에너지 생성 및 저장'],['Automotive','Energy generation and storage']],
  website:'https://www.tesla.com/',sources:[{url:'https://ir.tesla.com/',label:'Tesla — Investor Relations'},{url:'https://www.tesla.com/',label:'Tesla — Products'}],verifiedOn:'2026-10-31',
 },
 '005930':{
  description:['Samsung Electronics의 반도체 사업은 메모리, 시스템 반도체와 파운드리 기술을 제공합니다. 공식 Samsung Semiconductor 사이트는 메모리·스토리지, Exynos 프로세서, ISOCELL 이미지 센서와 파운드리 서비스를 소개합니다.','Samsung Electronics’ semiconductor business provides memory, system semiconductors and foundry technology. The official Samsung Semiconductor site describes memory and storage, Exynos processors, ISOCELL image sensors and foundry services.'],
  products:[['DRAM / LPDDR 메모리','UFS 스토리지','Exynos 프로세서','ISOCELL 이미지 센서','파운드리 서비스'],['DRAM / LPDDR memory','UFS storage','Exynos processors','ISOCELL image sensors','Foundry services']],
  areas:[['메모리 및 스토리지','시스템 반도체','파운드리'],['Memory and storage','System semiconductors','Foundry']],
  website:'https://www.samsung.com/',sources:[{url:'https://semiconductor.samsung.com/',label:'Samsung Semiconductor — Official product overview'}],verifiedOn:'2026-10-31',
  coverage:['이 설명은 확인 가능한 반도체 사업만 다룹니다. 삼성전자 전체 사업부 구성이나 보고 부문을 대신하지 않습니다.','This profile covers the verified semiconductor business only. It does not represent Samsung Electronics’ complete business or reporting segments.'],
 },
 '000660':{
  description:['SK hynix는 메모리 반도체 기술과 제품을 개발합니다. 공식 뉴스룸은 DRAM, HBM, NAND와 데이터센터용 저장 기술을 소개하며 AI 인프라에서의 활용을 설명합니다.','SK hynix develops memory semiconductor technology and products. Its official newsroom covers DRAM, HBM, NAND and data-center storage technology, including their use in AI infrastructure.'],
  products:[['DRAM','HBM','NAND','데이터센터 SSD'],['DRAM','HBM','NAND','Data-center SSDs']],
  areas:[['메모리 반도체','AI 메모리','스토리지'],['Memory semiconductors','AI memory','Storage']],
  website:'https://www.skhynix.com/',sources:[{url:'https://news.skhynix.com/',label:'SK hynix — Official newsroom and technology series'}],verifiedOn:'2026-10-31',
 },
 '005380':{
  description:['Hyundai Motor는 자동차 제조와 모빌리티 기술을 개발합니다. 공식 회사 소개는 전기차, 수소 기반 이동 수단, 소프트웨어 기반 차량과 미래 모빌리티 기술을 주요 방향으로 설명합니다.','Hyundai Motor manufactures vehicles and develops mobility technology. Its official company overview describes electric vehicles, hydrogen-powered mobility, software-defined vehicles and future mobility technologies.'],
  products:[['자동차','IONIQ 전기차','수소 모빌리티 기술'],['Vehicles','IONIQ electric vehicles','Hydrogen mobility technology']],
  areas:[['자동차','전동화 및 수소','소프트웨어 기반 모빌리티'],['Automotive','Electrification and hydrogen','Software-defined mobility']],
  website:'https://www.hyundai.com/',sources:[{url:'https://www.hyundai.com/worldwide/en/company',label:'Hyundai Motor — Our vision'}],verifiedOn:'2026-10-31',
 },
};
