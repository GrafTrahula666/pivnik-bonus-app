
declare module 'pg' {
 export interface QueryResultRow{[column:string]:unknown}
 export interface QueryResult<R extends QueryResultRow=any>{rows:R[];rowCount:number|null}
 export interface QueryConfig{ text:string; values?:readonly unknown[] }
 export interface Queryable{query<R extends QueryResultRow=any>(text:string|QueryConfig,values?:readonly unknown[]):Promise<QueryResult<R>>}
 export interface PoolClient extends Queryable{release():void}
 export class Pool implements Queryable{constructor(config?:Record<string,unknown>);query<R extends QueryResultRow=any>(text:string|QueryConfig,values?:readonly unknown[]):Promise<QueryResult<R>>;connect():Promise<PoolClient>;end():Promise<void>;on(event:string,listener:(...args:any[])=>void):this}
 const pg:{Pool:typeof Pool};export default pg
}
