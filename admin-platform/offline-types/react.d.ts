
declare module 'react' {
 export type ReactNode=any
 export type CSSProperties=Record<string,string|number|undefined>
 export interface FormEvent<T=Element>{preventDefault():void;currentTarget:T}
 export type SetStateAction<S>=S|((prev:S)=>S)
 export type Dispatch<A>=(value:A)=>void
 export function useState<S>(initial:S|(()=>S)):[S,Dispatch<SetStateAction<S>>]
 export function useState<S=undefined>():[S|undefined,Dispatch<SetStateAction<S|undefined>>]
 export function useEffect(effect:()=>void|(()=>void),deps?:readonly unknown[]):void
 export function useMemo<T>(factory:()=>T,deps:readonly unknown[]):T
 export const StrictMode:any
}
declare module 'react/jsx-runtime'{export const jsx:any;export const jsxs:any;export const Fragment:any}
declare namespace JSX {
 interface IntrinsicAttributes{key?:string|number}
 interface ChangeEvent{target:{value:string;checked:boolean;files?:FileList|null}}
 interface IntrinsicElements{
  input:{onChange?:(e:ChangeEvent)=>void;[key:string]:any}
  select:{onChange?:(e:ChangeEvent)=>void;[key:string]:any}
  textarea:{onChange?:(e:ChangeEvent)=>void;[key:string]:any}
  [elemName:string]:any
 }
}
