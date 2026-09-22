import type { AppContext } from '../app-context.ts';

/** Keep actual form nodes when descending, so returning preserves drafts and listeners. */
export function createModalPages(ctx:AppContext) {
    const root=document.querySelector<HTMLElement>('#modal-root')!;
    const parents:{node:HTMLElement;title:string;focus:HTMLElement|null;scroll:number}[]=[];
    const active=()=>root.firstElementChild as HTMLElement|null;
    const allowed=()=>!ctx.busy && (root.querySelector('.modal')?.dispatchEvent(new Event('director-before-close',{cancelable:true}))??true);
    const close=()=>{
        if(!allowed())return;
        // Close hooks belong to their own mounted form, including any saved parent draft.
        while(parents.length){const parent=parents.pop()!;root.replaceChildren(parent.node);if(!allowed()){decorate();return;}}
        root.replaceChildren();
    };
    const back=()=>{
        if(!parents.length){close();return;}
        if(!allowed())return;
        const parent=parents.pop()!;root.replaceChildren(parent.node);
        const body=root.querySelector<HTMLElement>('.modal-body');if(body)body.scrollTop=parent.scroll;
        decorate();parent.focus?.focus({preventScroll:true});
    };
    const decorate=()=>{
        const modal=root.querySelector<HTMLElement>('.modal');if(!modal)return;
        modal.querySelector('.modal-back')?.remove();
        if(!parents.length)return;
        let footer=modal.querySelector<HTMLElement>('.modal-footer');
        if(!footer){footer=document.createElement('footer');footer.className='modal-footer';modal.append(footer);}
        const button=document.createElement('button');button.className='modal-back subtle';button.type='button';
        button.textContent='返回';button.title='返回 '+parents.at(-1)!.title;
        button.onclick=event=>{event.stopPropagation();back();};footer.append(button);
    };
    return {close, show(title:string,node:HTMLElement){
        title=node.querySelector('.modal')?.getAttribute('aria-label')??title;
        const current=active(),modal=current?.querySelector('.modal'),oldTitle=modal?.getAttribute('aria-label')??'';
        if(current && oldTitle!==title) {
            const existing=parents.findIndex(p=>p.title===title);
            if(existing>=0)parents.splice(existing);
            else parents.push({node:current,title:oldTitle,focus:document.activeElement as HTMLElement,scroll:root.querySelector('.modal-body')?.scrollTop??0});
        }
        root.replaceChildren(node);decorate();
    }};
}

export function addPageBack(panel:HTMLElement,label:string,back:()=>void) {
    panel.querySelector('[data-parent-page-back]')?.remove();
    let footer=panel.querySelector<HTMLElement>('.ai-footer, .page-footer');
    if(!footer){footer=document.createElement('footer');footer.className='page-footer';panel.append(footer);}
    const button=document.createElement('button');button.type='button';button.dataset.parentPageBack='';button.className='subtle page-back';button.textContent='返回';button.title=label;
    button.onclick=event=>{event.stopPropagation();button.remove();back();};
    footer.append(button);
}
