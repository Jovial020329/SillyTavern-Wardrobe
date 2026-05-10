/**
 * Wardrobe Extension - 衣橱扩展
 * 通过LLM生成创意服装搭配描述，注入角色描述中
 */

import { CATEGORIES, CATEGORY_INFO } from './wardrobe-categories.js';

const MODULE_NAME = 'wardrobe';
const DEBUG_PREFIX = '[Wardrobe]';

// Default extension settings
const defaultSettings = {
    enabled: true,
    apiMode: 'st',
    customApiUrl: '',
    customApiKey: '',
    customModel: '',
    // 全局指导
    globalGuide: '',
    // 人物设定注入
    characterNotes: '',
    // 现有穿搭列表: [ { charName: "小雪", description: "白色衬衫..." } ]
    activeOutfits: [],
    // 已保存的搭配: [ { saveName: "小雪-学院风", charName: "小雪", gender: "female", description: "...", selections: {} } ]
    savedOutfits: [],
};

// Runtime state
let currentGender = 'female';
let currentCategory = '上衣';
let currentSelections = {};
let currentOutfitText = '';
let isGenerating = false;

function getContext() {
    return SillyTavern.getContext();
}

function getSettings() {
    var ctx = getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    var s = ctx.extensionSettings[MODULE_NAME];
    for (var key of Object.keys(defaultSettings)) {
        if (s[key] === undefined) {
            s[key] = defaultSettings[key];
        }
    }
    // 兼容旧版: 如果有旧的 outfits 对象但没有 activeOutfits，迁移
    if (!Array.isArray(s.activeOutfits)) {
        s.activeOutfits = [];
    }
    return s;
}

function saveSettings() {
    getContext().saveSettingsDebounced();
}

// 根据所有 activeOutfits 更新注入
function updateInjection() {
    var settings = getSettings();
    var ctx = getContext();
    if (settings.activeOutfits.length > 0 && settings.enabled) {
        var parts = settings.activeOutfits.map(function(o) {
            return '[' + o.charName + '当前穿着：' + o.description + ']';
        });
        ctx.setExtensionPrompt(MODULE_NAME, parts.join('\n'), 1, 0);
    } else {
        ctx.setExtensionPrompt(MODULE_NAME, '', 1, 0);
    }
}

function buildPanelHTML() {
    return '<div id="wardrobe_panel" class="extension_settings">'
        + '<div class="inline-drawer">'
        + '<div class="inline-drawer-toggle inline-drawer-header">'
        + '<b>👗 衣橱 Wardrobe</b>'
        + '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>'
        + '</div>'
        + '<div class="inline-drawer-content" style="display:none;">'

        // 注入状态
        + '<div class="wardrobe-status inactive" id="wardrobe_status">未注入穿搭描述</div>'

        // 性别切换
        + '<div class="wardrobe-controls">'
        + '<div class="wardrobe-gender-toggle">'
        + '<button data-gender="female" class="active">♀ 女</button>'
        + '<button data-gender="male">♂ 男</button>'
        + '</div>'
        + '</div>'

        // 全局指导
        + '<div class="wardrobe-notes-section">'
        + '<details>'
        + '<summary>🌍 全局指导（场景/氛围/特殊要求）</summary>'
        + '<textarea id="wardrobe_global_guide" rows="3" placeholder="例如：疫情时期 / 古代仙侠世界 / 海边度假 / 正式晚宴 / 80年代复古" style="width:100%;box-sizing:border-box;font-size:0.85em;margin-top:6px;padding:6px;resize:vertical;"></textarea>'
        + '</details></div>'

        // 人物设定注入
        + '<div class="wardrobe-notes-section">'
        + '<details>'
        + '<summary>📝 人物设定注入（生成时参考）</summary>'
        + '<textarea id="wardrobe_char_notes" rows="4" placeholder="例如：&#10;小雪：甜美可爱的邻家女孩，喜欢粉色和蝴蝶结&#10;李默：冷酷禁欲系男生，偏好暗色系" style="width:100%;box-sizing:border-box;font-size:0.85em;margin-top:6px;padding:6px;resize:vertical;"></textarea>'
        + '</details></div>'

        // 分类标签页
        + '<div class="wardrobe-category-tabs" id="wardrobe_tabs"></div>'

        // 属性标签 + 清除标签按钮
        + '<div class="wardrobe-attributes" id="wardrobe_attrs"></div>'
        + '<div style="margin-bottom:8px;"><button id="wardrobe_clear_tags" style="font-size:0.8em;padding:2px 8px;">🧹 清除所有标签</button></div>'

        // 角色名输入
        + '<div style="margin-bottom:8px;">'
        + '<label style="font-size:0.85em;font-weight:bold;display:block;margin-bottom:4px;">🏷 角色名</label>'
        + '<input type="text" id="wardrobe_char_input" placeholder="输入角色名（如：小雪）" style="width:100%;box-sizing:border-box;padding:4px 8px;font-size:0.85em;">'
        + '</div>'

        // 操作按钮
        + '<div class="wardrobe-actions">'
        + '<button id="wardrobe_generate" class="primary">🎲 随机生成</button>'
        + '<button id="wardrobe_apply">✅ 应用</button>'
        + '<button id="wardrobe_save_preset">💾 保存到收藏</button>'
        + '</div>'

        // 生成结果（可编辑）
        + '<textarea id="wardrobe_result" rows="4" placeholder="点击「随机生成」来生成穿搭描述...&#10;生成后可在此手动修改细节，确认后再点应用" style="width:100%;box-sizing:border-box;font-size:0.85em;padding:8px;margin-top:8px;resize:vertical;border:1px solid var(--SmartThemeBorderColor,#555);border-radius:6px;background:var(--SmartThemeBlurTintColor,rgba(0,0,0,0.2));color:var(--SmartThemeBodyColor,#ccc);line-height:1.5;"></textarea>'

        // 现有穿搭列表
        + '<div class="wardrobe-active-section">'
        + '<h4>📌 现有穿搭（正在注入AI）</h4>'
        + '<div id="wardrobe_active_list"></div>'
        + '</div>'

        // 已保存的搭配
        + '<div class="wardrobe-saved-section">'
        + '<h4>📂 已保存的搭配</h4>'
        + '<div class="wardrobe-saved-list" id="wardrobe_saved_list"></div>'
        + '</div>'

        // API 设置
        + '<div class="wardrobe-api-settings"><details>'
        + '<summary>⚙ API 设置</summary>'
        + '<div style="margin-top:6px;">'
        + '<div class="api-field"><label>API 模式</label>'
        + '<select id="wardrobe_api_mode">'
        + '<option value="st">使用酒馆主模型 (零配置)</option>'
        + '<option value="custom">独立API (省钱)</option>'
        + '</select></div>'
        + '<div id="wardrobe_custom_api_fields" style="display:none;">'
        + '<div class="api-field"><label>API 地址 (OpenAI兼容)</label>'
        + '<input type="text" id="wardrobe_api_url" placeholder="https://api.openai.com/v1"></div>'
        + '<div class="api-field"><label>API Key</label>'
        + '<input type="password" id="wardrobe_api_key" placeholder="sk-..."></div>'
        + '<div class="api-field"><label>模型名</label>'
        + '<input type="text" id="wardrobe_model" placeholder="gpt-4o-mini"></div>'
        + '</div></div></details></div>'

        + '</div></div></div>';
}

function renderPanel() {
    var settings = getSettings();
    jQuery('.wardrobe-gender-toggle button').removeClass('active');
    jQuery('.wardrobe-gender-toggle button[data-gender="' + currentGender + '"]').addClass('active');
    renderCategoryTabs();
    renderAttributes();
    renderResult();
    renderStatus();
    renderActiveList();
    renderSavedList();
    jQuery('#wardrobe_global_guide').val(settings.globalGuide);
    jQuery('#wardrobe_char_notes').val(settings.characterNotes);
    jQuery('#wardrobe_api_mode').val(settings.apiMode);
    jQuery('#wardrobe_api_url').val(settings.customApiUrl);
    jQuery('#wardrobe_api_key').val(settings.customApiKey);
    jQuery('#wardrobe_model').val(settings.customModel);
    jQuery('#wardrobe_custom_api_fields').toggle(settings.apiMode === 'custom');
}

function renderCategoryTabs() {
    var cats = Object.keys(CATEGORIES[currentGender]);
    var tabsHtml = cats.map(function(cat) {
        var info = CATEGORY_INFO[cat] || {};
        var active = cat === currentCategory ? 'active' : '';
        return '<button class="wardrobe-category-tab ' + active + '" data-cat="' + cat + '">' + (info.icon || '') + ' ' + cat + '</button>';
    }).join('');
    jQuery('#wardrobe_tabs').html(tabsHtml);
}

function renderAttributes() {
    var catData = CATEGORIES[currentGender] ? CATEGORIES[currentGender][currentCategory] : null;
    if (!catData) {
        jQuery('#wardrobe_attrs').html('<p style="font-size:0.85em;color:#888;">该分类暂无数据</p>');
        return;
    }
    var selections = currentSelections[currentCategory] || {};
    var html = '';
    for (var [dimension, values] of Object.entries(catData)) {
        var selected = selections[dimension] || [];
        var tagsHtml = values.map(function(v) {
            var sel = selected.includes(v) ? 'selected' : '';
            return '<span class="wardrobe-tag ' + sel + '" data-dim="' + dimension + '" data-val="' + v + '">' + v + '</span>';
        }).join('');
        html += '<div class="wardrobe-attr-section"><label>' + dimension + '</label><div class="wardrobe-tags">' + tagsHtml + '</div></div>';
    }
    jQuery('#wardrobe_attrs').html(html);
}

function renderResult() {
    var el = jQuery('#wardrobe_result');
    if (currentOutfitText) {
        el.val(currentOutfitText);
    } else {
        el.val('');
    }
}

function renderStatus() {
    var settings = getSettings();
    var el = jQuery('#wardrobe_status');
    var count = settings.activeOutfits.length;
    if (count > 0 && settings.enabled) {
        var names = settings.activeOutfits.map(function(o) { return o.charName; }).join('、');
        el.removeClass('inactive').addClass('active').text('✓ 正在注入 ' + count + ' 位角色的穿搭：' + names);
    } else {
        el.removeClass('active').addClass('inactive').text('未注入穿搭描述');
    }
}

function renderActiveList() {
    var settings = getSettings();
    var el = jQuery('#wardrobe_active_list');
    if (!settings.activeOutfits.length) {
        el.html('<p style="font-size:0.8em;color:#888;">暂无穿搭，请生成后应用</p>');
        return;
    }
    var html = settings.activeOutfits.map(function(item, idx) {
        return '<div class="wardrobe-saved-item" data-active-idx="' + idx + '">'
            + '<span class="saved-name" title="' + item.description + '"><b>' + item.charName + '</b>：' + item.description + '</span>'
            + '<span class="active-delete" data-active-idx="' + idx + '" title="移除此穿搭">✕</span>'
            + '</div>';
    }).join('');
    el.html(html);
}

function renderSavedList() {
    var settings = getSettings();
    var el = jQuery('#wardrobe_saved_list');
    if (!settings.savedOutfits.length) {
        el.html('<p style="font-size:0.8em;color:#888;">暂无保存的搭配</p>');
        return;
    }
    var html = settings.savedOutfits.map(function(item, idx) {
        return '<div class="wardrobe-saved-item" data-saved-idx="' + idx + '">'
            + '<span class="saved-name" title="' + item.description + '"><b>' + item.charName + '</b> - ' + item.saveName + '</span>'
            + '<span class="saved-delete" data-saved-idx="' + idx + '" title="删除">✕</span>'
            + '</div>';
    }).join('');
    el.html(html);
}

function buildPrompt() {
    var settings = getSettings();
    var genderText = currentGender === 'female' ? '女性' : '男性';
    var charName = jQuery('#wardrobe_char_input').val().trim();
    var constraints = [];
    for (var [cat, dims] of Object.entries(currentSelections)) {
        for (var [dim, vals] of Object.entries(dims)) {
            if (vals.length > 0) {
                constraints.push(cat + dim + '偏好：' + vals.join('、'));
            }
        }
    }
    var constraintText = constraints.length > 0
        ? '约束条件：\n' + constraints.join('\n')
        : '约束条件：无特殊要求，请自由发挥创意搭配';

    // 全局指导
    var guideText = '';
    if (settings.globalGuide && settings.globalGuide.trim()) {
        guideText = '场景/背景设定：' + settings.globalGuide.trim() + '\n';
    }

    // 人物设定注入
    var notesText = '';
    if (settings.characterNotes && settings.characterNotes.trim()) {
        notesText = '人物设定参考：\n' + settings.characterNotes.trim() + '\n';
    }

    var targetText = charName ? ('请为「' + charName + '」（' + genderText + '）生成') : ('请为一个' + genderText + '角色生成');

    return '你是一个服装搭配师。' + targetText + '一套穿搭描述。\n'
        + guideText
        + notesText
        + constraintText + '\n'
        + '要求：\n'
        + '- 用中文描述\n'
        + '- 简洁生动，100字以内\n'
        + '- 描述具体的款式、颜色、材质、搭配细节\n'
        + '- 只输出穿搭描述，不要其他内容';
}

async function generateOutfit() {
    var settings = getSettings();
    isGenerating = true;
    var btn = jQuery('#wardrobe_generate');
    var result = jQuery('#wardrobe_result');

    btn.prop('disabled', true).html('<span class="wardrobe-loading"></span>生成中...');
    result.val('正在生成穿搭描述...');

    try {
        var prompt = buildPrompt();
        var text;

        if (settings.apiMode === 'custom' && settings.customApiUrl) {
            text = await callCustomAPI(prompt, settings);
        } else {
            var ctx = getContext();
            text = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        }

        if (text) {
            currentOutfitText = text.trim().replace(/^["'\u300C]|["'\u300D]$/g, '');
            renderResult();
            toastr.success('穿搭描述已生成！');
        } else {
            toastr.error('生成失败：未返回结果');
        }
    } catch (err) {
        console.error(DEBUG_PREFIX + ' Generation error:', err);
        toastr.error('生成失败: ' + err.message);
        result.val('生成失败，请检查API设置');
    } finally {
        isGenerating = false;
        btn.prop('disabled', false).html('🎲 随机生成');
    }
}

async function callCustomAPI(prompt, settings) {
    var url = settings.customApiUrl.replace(/\/+$/, '');
    var response = await fetch(url + '/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + settings.customApiKey,
        },
        body: JSON.stringify({
            model: settings.customModel || 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0.9,
        }),
    });

    if (!response.ok) {
        var errText = await response.text();
        throw new Error('API ' + response.status + ': ' + errText.substring(0, 200));
    }

    var data = await response.json();
    return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
}

function bindEvents() {
    // 全局指导保存
    jQuery('#wardrobe_global_guide').on('input', function() {
        getSettings().globalGuide = jQuery(this).val();
        saveSettings();
    });

    // 人物设定注入保存
    jQuery('#wardrobe_char_notes').on('input', function() {
        getSettings().characterNotes = jQuery(this).val();
        saveSettings();
    });

    // 性别切换
    jQuery(document).on('click', '.wardrobe-gender-toggle button', function() {
        currentGender = jQuery(this).data('gender');
        currentCategory = '上衣';
        renderPanel();
    });

    // 分类切换
    jQuery(document).on('click', '.wardrobe-category-tab', function() {
        currentCategory = jQuery(this).data('cat');
        renderCategoryTabs();
        renderAttributes();
    });

    // 标签选择
    jQuery(document).on('click', '.wardrobe-tag', function() {
        var dim = jQuery(this).data('dim');
        var val = jQuery(this).data('val');
        if (!currentSelections[currentCategory]) currentSelections[currentCategory] = {};
        if (!currentSelections[currentCategory][dim]) currentSelections[currentCategory][dim] = [];
        var arr = currentSelections[currentCategory][dim];
        var idx = arr.indexOf(val);
        if (idx >= 0) { arr.splice(idx, 1); } else { arr.push(val); }
        jQuery(this).toggleClass('selected');
    });

    // 清除所有标签
    jQuery('#wardrobe_clear_tags').on('click', function() {
        currentSelections = {};
        renderAttributes();
        toastr.info('已清除所有标签');
    });

    // 随机生成
    jQuery('#wardrobe_generate').on('click', async function() {
        if (isGenerating) return;
        await generateOutfit();
    });

    // 应用：将当前穿搭添加到现有穿搭列表
    jQuery('#wardrobe_apply').on('click', function() {
        // 读取文本框中的内容（用户可能手动修改过）
        currentOutfitText = jQuery('#wardrobe_result').val().trim();
        if (!currentOutfitText) {
            toastr.warning('请先生成穿搭描述');
            return;
        }
        var charName = jQuery('#wardrobe_char_input').val().trim();
        if (!charName) {
            toastr.warning('请输入角色名');
            jQuery('#wardrobe_char_input').focus();
            return;
        }
        var settings = getSettings();
        // 如果该角色已有穿搭，替换它
        var existing = -1;
        for (var i = 0; i < settings.activeOutfits.length; i++) {
            if (settings.activeOutfits[i].charName === charName) {
                existing = i;
                break;
            }
        }
        var entry = { charName: charName, description: currentOutfitText };
        if (existing >= 0) {
            settings.activeOutfits[existing] = entry;
            toastr.success('已更新「' + charName + '」的穿搭！');
        } else {
            settings.activeOutfits.push(entry);
            toastr.success('已添加「' + charName + '」的穿搭！');
        }
        saveSettings();
        updateInjection();
        renderActiveList();
        renderStatus();
    });

    // 移除某个角色的穿搭
    jQuery(document).on('click', '.active-delete', function(e) {
        e.stopPropagation();
        var idx = jQuery(this).data('active-idx');
        var settings = getSettings();
        var name = settings.activeOutfits[idx] ? settings.activeOutfits[idx].charName : '';
        settings.activeOutfits.splice(idx, 1);
        saveSettings();
        updateInjection();
        renderActiveList();
        renderStatus();
        toastr.info('已移除「' + name + '」的穿搭');
    });

    // 保存到收藏
    jQuery('#wardrobe_save_preset').on('click', function() {
        if (!currentOutfitText) { toastr.warning('请先生成穿搭描述'); return; }
        var charName = jQuery('#wardrobe_char_input').val().trim() || '未命名';
        var saveName = prompt('为这套搭配起个名字：');
        if (!saveName) return;
        var settings = getSettings();
        settings.savedOutfits.push({
            saveName: saveName,
            charName: charName,
            gender: currentGender,
            description: currentOutfitText,
            selections: structuredClone(currentSelections),
        });
        saveSettings();
        renderSavedList();
        toastr.success('搭配已保存！');
    });

    // 点击已保存的搭配 → 添加到现有穿搭
    jQuery(document).on('click', '.wardrobe-saved-item[data-saved-idx] .saved-name', function() {
        var idx = jQuery(this).parent().data('saved-idx');
        var settings = getSettings();
        var item = settings.savedOutfits[idx];
        if (!item) return;
        // 检查是否已在 activeOutfits 中
        var existing = -1;
        for (var i = 0; i < settings.activeOutfits.length; i++) {
            if (settings.activeOutfits[i].charName === item.charName) {
                existing = i;
                break;
            }
        }
        var entry = { charName: item.charName, description: item.description };
        if (existing >= 0) {
            settings.activeOutfits[existing] = entry;
        } else {
            settings.activeOutfits.push(entry);
        }
        saveSettings();
        updateInjection();
        renderActiveList();
        renderStatus();
        toastr.success('已将「' + item.charName + '」的搭配添加到现有穿搭！');
    });

    // 删除已保存的搭配
    jQuery(document).on('click', '.wardrobe-saved-item[data-saved-idx] .saved-delete', function(e) {
        e.stopPropagation();
        var idx = jQuery(this).data('saved-idx');
        if (!confirm('确定删除这套搭配？')) return;
        var settings = getSettings();
        settings.savedOutfits.splice(idx, 1);
        saveSettings();
        renderSavedList();
    });

    // API 设置
    jQuery('#wardrobe_api_mode').on('change', function() {
        var settings = getSettings();
        settings.apiMode = jQuery(this).val();
        jQuery('#wardrobe_custom_api_fields').toggle(settings.apiMode === 'custom');
        saveSettings();
    });
    jQuery('#wardrobe_api_url').on('input', function() {
        getSettings().customApiUrl = jQuery(this).val();
        saveSettings();
    });
    jQuery('#wardrobe_api_key').on('input', function() {
        getSettings().customApiKey = jQuery(this).val();
        saveSettings();
    });
    jQuery('#wardrobe_model').on('input', function() {
        getSettings().customModel = jQuery(this).val();
        saveSettings();
    });
}

// Initialize
try {
    console.log(DEBUG_PREFIX + ' Initializing...');
    var html = buildPanelHTML();
    jQuery('#extensions_settings2').append(html);
    console.log(DEBUG_PREFIX + ' Panel appended.');
    bindEvents();
    updateInjection();
    renderPanel();

    var ctx = getContext();
    if (ctx.eventSource && ctx.event_types) {
        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, function() {
            updateInjection();
            renderPanel();
        });
    }
    console.log(DEBUG_PREFIX + ' Extension loaded successfully.');
} catch (err) {
    console.error(DEBUG_PREFIX + ' Init failed:', err);
}
