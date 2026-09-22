import { refreshTimelineSelection } from './timeline-selection-view.ts';
import { timelineOffset } from './timeline-preview.ts';
import { pathSections } from '../clip-editing.ts';
import { isSelected } from './clip-controls.ts';
import type { Entity } from '../model.ts';
import { clipLabel } from '../model.ts';
import { $, escape, icon } from './common.ts';
import type { AppContext } from '../app-context.ts';
import { sizeTimeline, timelineExtent } from './timeline-zoom.ts';
export function createTimeline(ctx: AppContext) {
    function pathBar(e: Entity, left: (t: number) => string, width: (a: number, b: number) => string) {
        if(e.path!.points.length===1){const p=e.path!.points[0];return `<button class="position-key-marker" data-act="seek-position-key" data-id="${e.id}" data-index="0" style="left:${left(p.time)}" title="位置关键帧 ${p.time.toFixed(2)} 秒">◆</button>`;}
        return pathSections(e.path!).map((part,index)=>`<div class="timeline-clip path ${isSelected({kind:'path',entityId:e.id,index})?'clip-selected':''}" data-path-id="${e.id}" data-section="${index}" style="--track-color:${e.color};left:${left(part.start)};width:${width(part.start,part.end)}"><span>${e.kind==='camera'?'运镜':'路径'} ${index+1} · ${(part.end-part.start).toFixed(2)}s</span><i class="resize-handle" data-resize="true" title="拖动此手柄调整时长"></i></div>`).join(''); }
    function renderTimeline() {
        const duration = timelineExtent(Math.max(ctx.project.duration,...(ctx.project.production?.notes.map(n => n.end) ?? []),...ctx.project.entities.flatMap(e=>[...e.clips.map(c=>c.end),...(e.path?pathSections(e.path).map(s=>s.end):[])])), ctx.time);
        const left = timelineOffset;
        const width = (a: number, b: number) => timelineOffset(b-a);
        let html = `<div class="timeline-row ruler-row"><span class="track-label">轨道 <small>${ctx.project.fps} fps</small></span><div class="ruler" data-seek="true" data-duration="${duration}" data-fps="${ctx.project.fps}">${Array.from({ length: 11 }, (_, i) => `<span data-tick style="left:${i * 10}%">${(duration * i / 10).toFixed(duration <= 10 ? 1 : 0)}</span>`).join('')}<div class="timeline-end-line" style="left:${left(ctx.project.duration)}" title="场景结束 ${ctx.project.duration} 秒"></div><div class="playhead-line"></div></div></div>`;
        html += `<div class="timeline-row cut-row"><span class="track-label">${icon('camera')}切镜 <small>${ctx.project.cuts.length} 段</small></span><div class="track-lane">${ctx.project.cuts.map((c, i) => `<div class="timeline-clip cut ${isSelected({kind:'cut',index:i})?'clip-selected':''}" data-cut="${i}" style="left:${left(c.time)};width:${width(c.time, ctx.project.cuts[i + 1]?.time ?? ctx.project.duration)}" title="${escape(ctx.project.entities.find(e => e.id === c.cameraId)?.name)} · ${c.time}s"><span>${escape(ctx.project.entities.find(e => e.id === c.cameraId)?.name)}</span>${i > 0 ? `<button data-act="delete-cut" data-index="${i}">×</button>` : ''}<i class="resize-handle" data-resize="true" title="拖动此手柄调整时长"></i></div>`).join('')}<div class="playhead-line"></div></div></div>`;
        for (const note of ctx.project.production?.notes ?? []) {
            html += `<div class="timeline-row" data-track-key="note:${escape(note.id)}"><span class="track-label">剧情备注</span><div class="track-lane"><button class="production-note-marker" data-act="production-open-note" data-note-id="${note.id}" style="left:${left(note.start)};width:${width(note.start,note.end)}" title="${escape(note.dialogue || note.story || note.emotion || '表演备注')} · 点击编辑">${escape(note.dialogue || note.story || note.emotion || '表演备注')}</button><div class="playhead-line"></div></div></div>`;
        }
        for (const e of ctx.project.entities.filter(e => e.kind !== 'prop' || e.path || e.clips.length)) {
            html += `<div data-track-key="entity:${escape(e.id)}" class="timeline-row ${e.id === ctx.selected ? 'selected' : ''}"><button class="track-label" data-select="${e.id}"><i style="background:${e.kind === 'camera' ? '#a1aab8' : e.color}"></i>${escape(e.name)}<small>${e.kind === 'camera' ? '运镜' : '动作'}</small></button><div class="track-lane">`;
            if (e.kind === 'camera' && e.camera!.mode !== 'free')
                html += `<div class="timeline-clip camera" style="left:0;width:${left(ctx.project.duration)}">${e.camera!.mode === 'pov' ? 'POV · 绑定' : '跟随对象'}</div>`;
            else if (e.kind === 'camera' || (e.kind === 'prop' && !e.clips.length)) {
                if (e.path)
                    html += pathBar(e, left, width);
                else
                    html += `<div class="timeline-clip idle" style="left:0;width:${left(ctx.project.duration)}">固定机位</div>`;
            }
            else
                for (const c of e.clips)
                    if (c.start < duration)
                        html += `<div class="timeline-clip ${isSelected({kind:'action',entityId:e.id,id:c.id})?'clip-selected':''}" data-entity="${e.id}" data-clip-id="${c.id}" style="--track-color:${e.color};left:${left(c.start)};width:${width(c.start, c.end)}"><span>${escape(c.native ? ctx.engine.externalModels.inspection(ctx.project.resources!.find(r => r.id === e.external!.resourceId)!).animations.find(a => a.index === c.native!.index)?.name ?? clipLabel(c) : clipLabel(c))}</span><i class="resize-handle" data-resize="true" title="拖动此手柄调整时长"></i></div>`;
            html += '<div class="playhead-line"></div></div></div>';
            if ((e.kind === 'actor' || e.kind === 'crowd' || (e.kind === 'prop' && e.clips.length)) && e.path)
                html += `<div data-track-key="path:${escape(e.id)}" class="timeline-row path-row ${e.id === ctx.selected ? 'selected' : ''}"><button class="track-label sub-track" data-select="${e.id}">⌁ &nbsp; 运动路径</button><div class="track-lane">${pathBar(e, left, width)}<div class="playhead-line"></div></div></div>`;
        }
        const scroll = $('#timeline-content').scrollTop, scrollX = $('#timeline-content').scrollLeft;
        $('#timeline-content').innerHTML = '<div class="timeline-tracks">' + html + '</div>';
        const tracks = $('#timeline-content .timeline-tracks');
        const order = new Map((ctx.project.editorView?.trackOrder ?? []).map((key,index)=>[key,index]));
        const rows = [...tracks.querySelectorAll<HTMLElement>('[data-track-key]')];
        rows.sort((a,b)=>(order.get(a.dataset.trackKey!) ?? Infinity)-(order.get(b.dataset.trackKey!) ?? Infinity));
        for (const row of rows) {
            const grip = document.createElement('span'); grip.dataset.trackGrip = ''; grip.className = 'track-grip'; grip.textContent = '⠿'; grip.tabIndex = 0; grip.setAttribute('role','button'); grip.title = '拖动排序 · Alt + ↑ / ↓'; grip.setAttribute('aria-label','调整轨道顺序');
            row.querySelector('.track-label')!.prepend(grip); tracks.append(row);
        }
        sizeTimeline();
        $('#timeline-content').scrollTop = scroll;
        $('#timeline-content').scrollLeft = scrollX;
        refreshTimelineSelection(ctx);
        ctx.updateTimeUI();
    }
    return { renderTimeline };
}
