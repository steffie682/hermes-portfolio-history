// Explicitly synthetic design data. Never import this file into a private data path.
import type { GardenLot, QuoteMap } from '@/garden/domain';
export const sampleLots:GardenLot[]=[
 {id:'00000000-0000-4000-8000-000000000001',code:'1001',name:'すずらん生活',account:'nisa',shares:'100',costPerShare:'1250',purchasedOn:'2025-04-18',confirmedOn:'2026-09-04',purchaseDps:'40',currentDps:'48',priorYearDps:'44',dividendAsOf:'2026-08-10',dividendSource:'架空の会社予想・デザイン確認用',memo:'日用品の継続需要と、無理のない普通配当の成長を確認する。これは架空の購入メモです。'},
 {id:'00000000-0000-4000-8000-000000000002',code:'1002',name:'月灯り工業',account:'nisa',shares:'200',costPerShare:'820',purchasedOn:'2025-09-12',confirmedOn:'2026-09-04',purchaseDps:'28',currentDps:'32',priorYearDps:'30',dividendAsOf:'2026-08-07',dividendSource:'架空の会社予想・デザイン確認用',memo:'設備更新の需要とキャッシュ創出を長い目で見る。実在する企業への評価ではありません。'},
 {id:'00000000-0000-4000-8000-000000000003',code:'1003',name:'こもれび商事',account:'taxable',shares:'100',costPerShare:'2400',purchasedOn:'2026-02-06',confirmedOn:'2026-09-04',purchaseDps:'85',currentDps:'90',priorYearDps:'85',dividendAsOf:'2026-08-05',dividendSource:'架空の会社予想・デザイン確認用',memo:'財務と配当の原資を定期的に確認する。サンプル用の記録です。'},
 {id:'00000000-0000-4000-8000-000000000004',code:'1004',name:'白鳥システムズ',account:'nisa',shares:'100',costPerShare:'1680',purchasedOn:'2026-06-19',confirmedOn:'2026-09-04',purchaseDps:'52',currentDps:'52',priorYearDps:'48',dividendAsOf:'2026-08-12',dividendSource:'架空の会社予想・デザイン確認用',memo:'継続収益を確認し、株価と業績の変化を分けて考える。架空の銘柄です。'},
];
export const sampleQuotes:QuoteMap=Object.fromEntries(sampleLots.map((l,i)=>[l.code,{code:l.code,close:['1430','790','2680','1795'][i],date:'2026-09-04',source:'synthetic-preview'}]));
