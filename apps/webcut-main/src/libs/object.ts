// @ts-nocheck

import { isEmpty } from 'ts-fns';

/**
 * 只把comming中非none的值覆盖到target中
 * @param {*} target
 * @param {*} coming
 */
export function assignNotEmpty(target, coming) {
    if (!coming) {
        return target;
    }
    const keys = Object.keys(coming);
    keys.forEach(key => {
        if (isEmpty(coming[key])) {
            return;
        }
        target[key] = coming[key];
    });
    return target;
}


/**
 * 只覆盖target中为空的值
 * @param {*} target
 * @param {*} coming
 */
export function assignToEmptyOnly(target, coming) {
    if (!coming) {
        return target;
    }
    const keys = Object.keys(coming);
    keys.forEach((key) => {
        if (isEmpty(target[key])) {
            target[key] = coming[key];
        }
    });
    return target;
}

/**
 * 只覆盖target中存在的属性值
 * @param {*} target
 * @param {*} coming
 */
export function assignToExistOnly(target, coming) {
    if (!coming) {
        return target;
    }
    const keys = Object.keys(coming);
    keys.forEach((key) => {
        if (key in target) {
            target[key] = coming[key];
        }
    });
    return target;
}
