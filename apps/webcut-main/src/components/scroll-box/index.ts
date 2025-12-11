import { inject } from 'vue';

export function useScrollBox(): any {
    return inject('scroller');
}