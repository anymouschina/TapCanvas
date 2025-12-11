const fontMap = new Map();

let denyMessage: any;
export async function requestLocalFontsPermission() {
    if (typeof denyMessage !== 'undefined') {
        if (denyMessage) {
            throw new Error(denyMessage);
        }
        return;
    }

    // @ts-ignore
    if (!window.queryLocalFonts) {
        denyMessage = 'queryLocalFonts API is not available on this platform.';
        throw new Error(denyMessage);
    }

    // @ts-ignore
    const status = await navigator.permissions.query({ name: "local-fonts" });
    if (status.state === "granted") {
        console.log('LocalFonts Permission was granted 👍');
    }
    else if (status.state === "prompt") {
        console.log('LocalFonts Permission will be requested');
    }
    else {
        denyMessage = 'LocalFonts Permission was denied.';
        throw new Error(denyMessage);
    }

    // 没有问题，可以往下走
    denyMessage = null;
}

export async function loadLocalFonts(search?: string) {
    await requestLocalFontsPermission();

    // Query fonts, with optional postsscript name filter.
    const optionalFilterArr = (search || '').split(',')
        .map(str => str.trim())
        .filter(str => str !== '');

    let fonts;
    if (optionalFilterArr.length > 0) {
        // @ts-ignore
        fonts = await window.queryLocalFonts({ postscriptNames: optionalFilterArr });
    } else {
        // @ts-ignore
        fonts = await window.queryLocalFonts();
    }

    // Processed response.
    if (fonts.length === 0) {
        console.warn('No locale fonts returned.');
        return;
    }

    fonts.forEach((font: any) => {
        fontMap.set(font.postscriptName, font);
    });

    return fonts;
}

export function useLocalFont(postscriptName: string) {
    const fontData = fontMap.get(postscriptName);
    const fontFace = {
        fontFamily: `"${fontData.postscriptName}"`,
        src: `local("${fontData.postscriptName}")`,
    };
    const css = {
        fontFamily: `"${fontData.postscriptName}"`,
    };
    return {
        fontFace,
        css,
        fontData,
    };
}

export async function getLocalFontOutlineFormat(fontdata: any) {
    const bytes = await fontdata.blob();
    // Inspect the first four bytes, which for SFNT define the format.
    // Spec: https://docs.microsoft.com/en-us/typography/opentype/spec/otff#organization-of-an-opentype-font
    const sfntVersion = await bytes.slice(0, 4).text();
    let outlineFormat = "UNKNOWN";
    switch (sfntVersion) {
        case '\x00\x01\x00\x00':
        case 'true':
        case 'typ1':
            outlineFormat = "truetype";
            break;
        case 'OTTO':
            outlineFormat = "cff";
            break;
    }
    return outlineFormat;
}