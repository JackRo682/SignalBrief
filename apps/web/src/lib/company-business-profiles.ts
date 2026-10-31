/** Editorial descriptions verified against the listed first-party pages.
 * These are business areas, not inferred accounting/reporting segments.
 * Tickers are resolved from the authenticated canonical company resource. */
export type BusinessProfile={
 description:[string,string];products:[string[],string[]];areas:[string[],string[]];
 website:string;sources:{url:string;label:string}[];verifiedOn:string;coverage?:[string,string];
};
export const companyBusinessProfiles:Readonly<Record<string,BusinessProfile>>={
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
