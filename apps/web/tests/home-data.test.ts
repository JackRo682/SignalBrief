import { describe, expect, it } from "vitest";
import type { Company } from "../src/lib/contracts";
import { resourceSchema } from "../src/workspace/contracts";
import {
  activityDay, activityWhen, calendarActivity, combineActivities,
  followedUpcoming, followingActivities, newsActivities, resourceActivity,
} from "../src/redesign/home-data";

const company: Company = { id:"22000000-0000-4000-8000-000000000001",name:"Followed",ticker:"AAPL",market:"US",provider:"sec",is_demo:false,last_ingested_at:null };
const other = { ...company,id:"22000000-0000-4000-8000-000000000002",name:"Unfollowed" };
const filing = resourceSchema.parse({ id:"33000000-0000-4000-8000-000000000001",kind:"filing",title:"Source",summary:"",company_id:company.id,company_name:company.name,ticker:company.ticker,market:"US",source_url:"https://example.com/source",published_at:"2026-11-04T00:00:00Z",publication_precision:"timestamp",category:"",is_saved:false });
const analysis = { ...filing,kind:"us_analysis" as const,filing_id:filing.id,reviewed_at:"2026-11-04T01:00:00Z",title:"Approved excerpt" };
const event = {id:"44000000-0000-4000-8000-000000000001",company_id:company.id,company_name:company.name,title:"Confirmed date",occurs_on:"2026-11-06",source_url:"https://example.com/event",source_timezone:null,verified_at:"2026-11-04T00:00:00Z",origin:"official_ir",event_id:null,quote:null};
const row = {company_id:company.id,latest_filing:filing,latest_analysis:analysis,next_event:null,last_collected_at:null,filing_count:100,analysis_count:40};

describe("homepage source composition", () => {
  it("intersects all-company fallback records and news with the actual watchlist", () => {
    const unrelated={...filing,id:"other",company_id:other.id};
    const news=newsActivities({provider:"NAVER",query:"Synthetic",retrievedAt:"2026-11-04T00:00:00Z",items:[{title:"Unfollowed news",link:"https://example.com/news",originalLink:null,publishedAt:"2026-11-04T03:00:00Z"}]},{id:other.id,company_name:other.name,ticker:other.ticker});
    const rows=followingActivities([row,{...row,company_id:other.id,latest_filing:unrelated,latest_analysis:null}],[company],news);
    expect(rows.map(x=>x.title)).toEqual(["Approved excerpt","Source"]);
    expect(followingActivities([row],[],news)).toEqual([]);
    expect(followingActivities([{...row,latest_filing:unrelated,latest_analysis:null}],[company])).toEqual([]);
  });
  it("uses analysis approval dates and preserves document/analysis identity sharing the same id", () => {
    const source=resourceActivity(filing,"document"), reviewed=resourceActivity(analysis,"analysis");
    expect(reviewed.date).toBe(analysis.reviewed_at);
    expect(reviewed.href).toBe(`/documents/${filing.id}?kind=filing&analysis=us`);
    expect(source.href).toBe(`/documents/${filing.id}?kind=filing`);
    expect(combineActivities([source,reviewed],[source]).map(x=>x.kind)).toEqual(["analysis","document"]);
    expect(resourceActivity({...analysis,reviewed_at:null},"analysis").date).toBeNull();
  });
  it("preserves date-only source days and never invents relative time or approval dates", () => {
    const source=resourceActivity({...filing,published_at:"2026-11-04T23:59:00Z",publication_precision:"date"},"document");
    expect(activityDay(source)).toBe("2026-11-04");
    expect(activityWhen(source,new Date("2026-11-04T23:59:30Z"))).toBe("2026. 11. 04");
    expect(activityDay({...source,precision:"timestamp"})).toBe("2026-11-05");
    expect(activityWhen(resourceActivity({...analysis,reviewed_at:null},"analysis"),new Date())).toBe("날짜 미제공");
    expect(activityWhen(resourceActivity(filing,"document"),new Date("2026-11-04T02:00:00Z"))).toBe("2시간 전");
  });
  it("keeps upcoming official followed dates inside the requested range and canonical occurrence links", () => {
    const rows=followedUpcoming([event,{...event,id:"prior",occurs_on:"2026-11-03"},{...event,id:"later",occurs_on:"2026-12-05"},{...event,id:"personal",origin:"user"},{...event,id:"unfollowed",company_id:other.id}],[company],"2026-11-04","2026-12-04");
    expect(rows).toEqual([event]);
    expect(calendarActivity(event)).toMatchObject({href:`/events/${event.id}?kind=calendar`,date:"2026-11-06",precision:"date"});
  });
  it("retains selected-company attribution and original article links, deduplicating repeated results", () => {
    const response={provider:"NAVER" as const,query:"Synthetic",retrievedAt:"2026-11-04T00:00:00Z",items:[{title:"News",link:"https://news.naver.com/fixture",originalLink:"https://example.com/original",publishedAt:"2026-11-04T00:00:00Z"}]};
    const news=newsActivities(response,{id:company.id,company_name:company.name,ticker:company.ticker});
    expect(news[0]).toMatchObject({companyId:company.id,companyName:"Followed",href:"https://example.com/original",external:true});
    expect(combineActivities(news,news)).toHaveLength(1);
    expect(newsActivities(response,undefined)).toEqual([]);
  });
});
