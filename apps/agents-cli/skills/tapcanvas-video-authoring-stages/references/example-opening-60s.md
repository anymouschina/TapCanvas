# 原创范例：工坊会合的两个片段

这份短场景为公开结构示例原创。两个30秒片段展示有空间站位的当下、没有站位的四段回忆，以及逐字绑定来源对白；不要求其它任务复用人物、时长或镜头数。片段和声音由作者声明，宿主只验证结构与真实来源引用。

```json
{
  "wholeFilmIntent": "社区工坊的尺寸复核：周禾回想修图过程，欢迎两位同伴，最后发现比例尺贴反。",
  "sourceKind": "narrative",
  "characters": [
    "周禾",
    "陶叔",
    "许岚",
    "孟雨"
  ],
  "adaptation": [
    {
      "spanId": "s-wait",
      "until": "周禾在桌前等同伴来核对图纸。",
      "decision": "dramatize",
      "note": "工坊外观与桌前等待。"
    },
    {
      "spanId": "s-past",
      "until": "他们约好今天在社区工坊会合。",
      "decision": "dramatize",
      "note": "四段工作回忆以画外音与交谈连接。"
    },
    {
      "spanId": "s-meet",
      "until": "先别拿，比例尺贴反了！",
      "decision": "dramatize",
      "note": "会合、问候、检查工具，停在比例尺的发现。"
    }
  ],
  "scenes": [
    {
      "sceneId": "street",
      "setting": "工坊街边，傍晚暖光",
      "place": "社区工坊",
      "adapts": [
        "s-wait"
      ],
      "cast": [],
      "entryState": "街边门牌在晚霞中亮起",
      "exitState": "镜头停在二楼工作间的窗边",
      "layout": {
        "landmarks": [
          {
            "kind": "area",
            "label": "工坊入口",
            "at": [
              0.5,
              0.2
            ]
          }
        ],
        "marks": [
          {
            "mark": "街心",
            "where": "工作台附近的指定位置",
            "at": [
              0.5,
              0.7
            ]
          }
        ]
      },
      "positions": [],
      "beats": [
        {
          "performance": "atmosphere",
          "picture": "工坊外观全景，镜头沿木门上摇，停在社区工坊门牌和二楼亮着灯的窗上。",
          "visible": [],
          "shows": [
            "U1"
          ],
          "clipId": "opening-memory"
        }
      ]
    },
    {
      "sceneId": "room",
      "setting": "工坊工作间，窗边工作台",
      "place": "社区工坊",
      "adapts": [
        "s-wait"
      ],
      "cast": [
        "周禾"
      ],
      "entryState": "周禾坐在摊开图纸的工作台前",
      "exitState": "周禾看着比例尺，等待同伴",
      "layout": {
        "landmarks": [
          {
            "kind": "door",
            "label": "工坊入口",
            "at": [
              0.5,
              0
            ]
          },
          {
            "kind": "window",
            "label": "工坊入口",
            "at": [
              0,
              0.5
            ]
          },
          {
            "kind": "furniture",
            "label": "工坊入口",
            "at": [
              0.5,
              0.55
            ]
          }
        ],
        "marks": [
          {
            "mark": "主位",
            "where": "工作台附近的指定位置",
            "at": [
              0.5,
              0.4
            ]
          },
          {
            "mark": "门内",
            "where": "工作台附近的指定位置",
            "at": [
              0.5,
              0.08
            ]
          },
          {
            "mark": "门外左",
            "where": "工作台附近的指定位置",
            "at": [
              0.38,
              0
            ]
          },
          {
            "mark": "门外右",
            "where": "工作台附近的指定位置",
            "at": [
              0.62,
              0
            ]
          },
          {
            "mark": "桌西",
            "where": "工作台附近的指定位置",
            "at": [
              0.32,
              0.6
            ]
          },
          {
            "mark": "桌东",
            "where": "工作台附近的指定位置",
            "at": [
              0.68,
              0.6
            ]
          }
        ]
      },
      "positions": [
        {
          "who": "周禾",
          "mark": "主位",
          "posture": "sit"
        }
      ],
      "beats": [
        {
          "performance": "atmosphere",
          "picture": "周禾坐在工作台前，把卷起的图纸摊平，将黄色卷尺压在纸边。",
          "visible": [
            "周禾"
          ],
          "shows": [
            "U2"
          ],
          "clipId": "opening-memory"
        },
        {
          "performance": "dialogue",
          "picture": "周禾低头端详比例尺，眉头稍松，手指沿刻度缓缓移动。",
          "visible": [
            "周禾"
          ],
          "speech": {
            "speaker": "周禾",
            "voice": "inner",
            "delivery": "平静，带点自嘲",
            "says": "U3"
          },
          "clipId": "opening-memory"
        }
      ]
    },
    {
      "sceneId": "past-life",
      "setting": "回忆：工坊展板前，午后",
      "place": "社区工坊",
      "adapts": [
        "s-past"
      ],
      "cast": [],
      "entryState": "旧图纸挂在展板上",
      "exitState": "错误的尺寸标记被圈出",
      "memoryVoice": {
        "speaker": "周禾",
        "voice": "offscreen",
        "delivery": "平静",
        "says": "上周，我发现图纸上的一处尺寸画错了。",
        "conveys": [
          "U4"
        ],
        "clipId": "opening-memory"
      },
      "beats": [
        {
          "performance": "flashback",
          "picture": "周禾拿直尺比着展板上的尺寸，发现纸上的线段与实际木框不相符。",
          "visible": [],
          "shows": [
            "U4"
          ],
          "clipId": "opening-memory"
        },
        {
          "performance": "flashback",
          "picture": "直尺和图纸特写，周禾用铅笔圈出错位的尺寸标记。",
          "visible": [],
          "shows": [
            "U4"
          ],
          "clipId": "opening-memory"
        }
      ]
    },
    {
      "sceneId": "rebirth",
      "setting": "回忆：库房与工作台",
      "place": "社区工坊",
      "adapts": [
        "s-past"
      ],
      "cast": [],
      "entryState": "卷起的备份图放在木箱里",
      "exitState": "比例尺与尺寸标记重新对齐",
      "memoryVoice": {
        "speaker": "周禾",
        "voice": "offscreen",
        "delivery": "平静",
        "says": "后来，我在库房找到了完整的备份图。",
        "conveys": [
          "U5",
          "U6"
        ],
        "clipId": "opening-memory"
      },
      "beats": [
        {
          "performance": "flashback",
          "picture": "周禾拉开木箱，捧出用麻绳扎好的备份图纸。",
          "visible": [],
          "shows": [
            "U5"
          ],
          "clipId": "opening-memory"
        },
        {
          "performance": "flashback",
          "picture": "周禾展开备份图，沿着比例尺重新标记工作台的长度。",
          "visible": [
            "周禾"
          ],
          "enters": [
            "周禾"
          ],
          "shows": [
            "U6"
          ],
          "clipId": "opening-memory"
        }
      ]
    },
    {
      "sceneId": "rescue",
      "setting": "回忆：工作台维修",
      "place": "社区工坊",
      "adapts": [
        "s-past"
      ],
      "cast": [
        "周禾",
        "陶叔"
      ],
      "entryState": "陶叔扶住倾斜的桌腿",
      "exitState": "桌脚重新平稳",
      "memoryVoice": {
        "speaker": "周禾",
        "voice": "offscreen",
        "delivery": "平静",
        "says": "前天，我和陶叔修好了工作台。",
        "conveys": [
          "U11",
          "U7"
        ],
        "clipId": "opening-memory"
      },
      "beats": [
        {
          "performance": "flashback",
          "picture": "周禾俯身调好桌脚垫片，陶叔扶住台面，待工作台稳住后松开双手。",
          "visible": [
            "周禾",
            "陶叔"
          ],
          "shows": [
            "U7"
          ],
          "clipId": "opening-memory"
        }
      ]
    },
    {
      "sceneId": "chess",
      "setting": "回忆：复核计划",
      "place": "社区工坊",
      "adapts": [
        "s-past"
      ],
      "cast": [
        "陶叔",
        "周禾"
      ],
      "entryState": "工具与图纸摆在桌上",
      "exitState": "周禾答应共同复核",
      "memoryVoice": {
        "speaker": "陶叔",
        "voice": "onscreen",
        "delivery": "眉飞色舞",
        "says": "我请了两位同伴来帮忙复核。",
        "conveys": [
          "U8"
        ],
        "clipId": "opening-memory"
      },
      "beats": [
        {
          "performance": "flashback",
          "picture": "陶叔坐在工作台边，拿起两位同伴的联系卡片，示意周禾找她们帮忙。",
          "visible": [
            "陶叔",
            "周禾"
          ],
          "shows": [
            "U8"
          ],
          "clipId": "opening-memory"
        },
        {
          "performance": "flashback",
          "picture": "陶叔把卡片推到桌中，指向卡片背面的专业项目，神情笃定。",
          "visible": [
            "陶叔",
            "周禾"
          ],
          "speech": {
            "speaker": "陶叔",
            "voice": "onscreen",
            "delivery": "得意地",
            "says": "她们对这些尺寸很熟。",
            "conveys": [
              "U8"
            ]
          },
          "clipId": "opening-memory"
        },
        {
          "performance": "flashback",
          "picture": "周禾将卡片夹进图纸，点头应下，给桌边留出两张椅子。",
          "visible": [
            "陶叔",
            "周禾"
          ],
          "speech": {
            "speaker": "周禾",
            "voice": "onscreen",
            "delivery": "笑着应下",
            "says": "那就一起核对。",
            "conveys": [
              "U9"
            ]
          },
          "clipId": "opening-memory"
        }
      ]
    },
    {
      "sceneId": "room-wait",
      "setting": "回到工坊工作间",
      "place": "社区工坊",
      "adapts": [
        "s-past"
      ],
      "cast": [
        "周禾"
      ],
      "entryState": "图纸已摊平",
      "exitState": "周禾转头看向门口",
      "beats": [
        {
          "performance": "atmosphere",
          "picture": "周禾在工作台前坐好，听到走廊里的脚步声后看向入口。",
          "visible": [
            "周禾"
          ],
          "clipId": "opening-memory"
        }
      ]
    },
    {
      "sceneId": "room-meet",
      "setting": "工坊工作间与走廊",
      "place": "社区工坊",
      "adapts": [
        "s-meet"
      ],
      "cast": [
        "周禾"
      ],
      "entryState": "周禾准备迎接同伴",
      "exitState": "许岚指出比例尺贴反，周禾停手",
      "beats": [
        {
          "performance": "action",
          "picture": "木门轻震，周禾从图纸上抬眼。",
          "visible": [
            "周禾"
          ],
          "shows": [
            "U10"
          ],
          "clipId": "meeting"
        },
        {
          "performance": "action",
          "picture": "周禾放好铅笔，扶桌站起，走到门边。",
          "visible": [
            "周禾"
          ],
          "shows": [
            "U11"
          ],
          "moves": [
            {
              "who": "周禾",
              "mark": "门内",
              "posture": "stand"
            }
          ],
          "clipId": "meeting"
        },
        {
          "performance": "action",
          "picture": "周禾推开门，看见许岚和孟雨各拿着一只工具箱站在走廊。",
          "visible": [
            "周禾",
            "许岚",
            "孟雨"
          ],
          "enters": [
            "许岚",
            "孟雨"
          ],
          "shows": [
            "U12",
            "U13",
            "U14"
          ],
          "moves": [
            {
              "who": "许岚",
              "mark": "门外左",
              "posture": "stand"
            },
            {
              "who": "孟雨",
              "mark": "门外右",
              "posture": "stand"
            }
          ],
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "周禾扶住门，微笑着向两位同伴自我介绍。",
          "visible": [
            "周禾",
            "许岚",
            "孟雨"
          ],
          "speech": {
            "speaker": "周禾",
            "voice": "onscreen",
            "delivery": "温和有礼",
            "says": "U15"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "许岚向前半步，把测量记录递给周禾。",
          "visible": [
            "许岚"
          ],
          "speech": {
            "speaker": "许岚",
            "voice": "onscreen",
            "delivery": "客气",
            "says": "U16"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "周禾接过记录，点头问候许岚。",
          "visible": [
            "周禾"
          ],
          "speech": {
            "speaker": "周禾",
            "voice": "onscreen",
            "delivery": "礼貌",
            "says": "U17"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "许岚转向孟雨，用手示意她手中的记事夹。",
          "visible": [
            "许岚",
            "孟雨",
            "周禾"
          ],
          "speech": {
            "speaker": "许岚",
            "voice": "onscreen",
            "delivery": "轻快，说得很快",
            "says": "U18"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "周禾向孟雨点头，抬手指了指工作台。",
          "visible": [
            "周禾",
            "孟雨"
          ],
          "speech": {
            "speaker": "周禾",
            "voice": "onscreen",
            "delivery": "恍然，客气",
            "says": "U19"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "周禾让出通道，示意二人进屋，在桌边放下工具箱。",
          "visible": [
            "周禾",
            "许岚",
            "孟雨"
          ],
          "speech": {
            "speaker": "周禾",
            "voice": "onscreen",
            "delivery": "先顺口，后迟疑",
            "says": "U20"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "孟雨把记事夹摊在图纸旁，确认今天要核对的项目。",
          "visible": [
            "孟雨"
          ],
          "speech": {
            "speaker": "孟雨",
            "voice": "onscreen",
            "delivery": "尴尬",
            "says": "U21"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "周禾走向工具箱，手刚碰到卷尺，许岚就指向图纸边上的比例尺。",
          "visible": [
            "周禾",
            "许岚",
            "孟雨"
          ],
          "moves": [
            {
              "who": "许岚",
              "mark": "桌西",
              "posture": "stand"
            },
            {
              "who": "孟雨",
              "mark": "桌东",
              "posture": "stand"
            }
          ],
          "speech": {
            "speaker": "周禾",
            "voice": "onscreen",
            "delivery": "爽朗",
            "says": "U22"
          },
          "clipId": "meeting"
        },
        {
          "performance": "dialogue",
          "picture": "工坊准备阶段8：许岚、周禾完成第12个动作，图纸与工具保持已声明的空间位置。",
          "visible": [
            "许岚",
            "周禾"
          ],
          "speech": {
            "speaker": "许岚",
            "voice": "onscreen",
            "delivery": "急忙",
            "says": "U23"
          },
          "clipId": "meeting"
        }
      ]
    }
  ],
  "clips": [
    {
      "clipId": "opening-memory",
      "durationSeconds": 30
    },
    {
      "clipId": "meeting",
      "durationSeconds": 30
    }
  ]
}
```
