/**
 * Copyright 2024 Tecnativa - Carlos López
 * License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
 */
import {_t} from "@web/core/l10n/translation";
import {exprToBoolean} from "@web/core/utils/strings";
import {parseExpr} from "@web/core/py_js/py";
import {visitXML} from "@web/core/utils/xml";

const {DateTime} = luxon;
const MODES = ["day", "week", "month", "fit"];

export class TimelineParseArchError extends Error {}

export class TimelineArchParser {
    parse(arch, fields) {
        const archInfo = {
            colors: [],
            class: "",
            templateDocs: {},
            min_height: 300,
            mode: "fit",
            canCreate: true,
            canUpdate: true,
            canDelete: true,
            canUpdateGroup: true,
            day_mode: false,
            use_formview_action: false,
            options: {
                groupOrder: "order",
                orientation: {axis: "both", item: "top"},
                selectable: true,
                multiselect: true,
                showCurrentTime: true,
                stack: true,
                margin: {item: 2},
                zoomKey: "ctrlKey",
            },
        };
        const fieldNames = fields.display_name ? ["display_name"] : [];
        visitXML(arch, (node) => {
            switch (node.tagName) {
                case "timeline": {
                    if (!node.hasAttribute("date_start")) {
                        throw new TimelineParseArchError(
                            _t("Timeline view has not defined 'date_start' attribute.")
                        );
                    }
                    if (!node.hasAttribute("default_group_by")) {
                        throw new TimelineParseArchError(
                            _t(
                                "Timeline view has not defined 'default_group_by' attribute."
                            )
                        );
                    }
                    archInfo.date_start = node.getAttribute("date_start");
                    archInfo.default_group_by = node.getAttribute("default_group_by");
                    if (node.hasAttribute("class")) {
                        archInfo.class = node.getAttribute("class");
                    }
                    if (node.hasAttribute("date_stop")) {
                        archInfo.date_stop = node.getAttribute("date_stop");
                    }
                    if (node.hasAttribute("date_delay")) {
                        archInfo.date_delay = node.getAttribute("date_delay");
                    }
                    if (node.hasAttribute("colors")) {
                        archInfo.colors = this.parse_colors(
                            node.getAttribute("colors")
                        );
                    }
                    if (node.hasAttribute("dependency_arrow")) {
                        archInfo.dependency_arrow =
                            node.getAttribute("dependency_arrow");
                    }
                    if (node.hasAttribute("stack")) {
                        archInfo.options.stack = exprToBoolean(
                            node.getAttribute("stack"),
                            true
                        );
                    }
                    if (node.hasAttribute("zoomKey")) {
                        archInfo.options.zoomKey =
                            node.getAttribute("zoomKey") || "ctrlKey";
                    }
                    if (node.hasAttribute("margin")) {
                        archInfo.options.margin = node.getAttribute("margin")
                            ? JSON.parse(node.getAttribute("margin"))
                            : {item: 2};
                    }
                    if (node.hasAttribute("min_height")) {
                        archInfo.min_height = node.getAttribute("min_height");
                    }
                    if (node.hasAttribute("mode")) {
                        archInfo.mode = node.getAttribute("mode");
                        if (!MODES.includes(archInfo.mode)) {
                            throw new TimelineParseArchError(
                                `Timeline view cannot display mode: ${archInfo.mode}`
                            );
                        }
                    }
                    if (node.hasAttribute("event_open_popup")) {
                        archInfo.open_popup_action = exprToBoolean(
                            node.getAttribute("event_open_popup")
                        );
                    }
                    if (node.hasAttribute("create")) {
                        archInfo.canCreate = exprToBoolean(
                            node.getAttribute("create"),
                            true
                        );
                    }
                    if (node.hasAttribute("edit")) {
                        archInfo.canUpdate = exprToBoolean(
                            node.getAttribute("edit"),
                            true
                        );
                    }
                    if (node.hasAttribute("delete")) {
                        archInfo.canDelete = exprToBoolean(
                            node.getAttribute("delete"),
                            true
                        );
                    }
                    if (node.hasAttribute("edit_group")) {
                        archInfo.canUpdateGroup = exprToBoolean(
                            node.getAttribute("edit_group"),
                            true
                        );
                    }
                    if (node.hasAttribute("color_field")) {
                        archInfo.color_field = node.getAttribute("color_field");
                    }
                    if (node.hasAttribute("readonly_field")) {
                        archInfo.readonly_field = node.getAttribute("readonly_field");
                    }
                    if (node.hasAttribute("all_day")) {
                        archInfo.all_day = node.getAttribute("all_day");
                    }
                    if (node.hasAttribute("day_mode")) {
                        archInfo.day_mode = exprToBoolean(
                            node.getAttribute("day_mode")
                        );
                    }
                    if (node.hasAttribute("use_formview_action")) {
                        archInfo.use_formview_action = exprToBoolean(
                            node.getAttribute("use_formview_action")
                        );
                    }
                    break;
                }
                case "field": {
                    const fieldName = node.getAttribute("name");
                    if (!fieldNames.includes(fieldName)) {
                        fieldNames.push(fieldName);
                    }
                    break;
                }
                case "t": {
                    if (node.hasAttribute("t-name")) {
                        archInfo.templateDocs[node.getAttribute("t-name")] = node;
                        break;
                    }
                }
            }
        });

        const fieldsToGather = [
            "date_start",
            "date_stop",
            "default_group_by",
            "progress",
            "date_delay",
            "color_field",
            "readonly_field",
            "all_day",
            archInfo.default_group_by,
        ];

        for (const field of fieldsToGather) {
            if (archInfo[field] && !fieldNames.includes(archInfo[field])) {
                fieldNames.push(archInfo[field]);
            }
        }
        for (const color of archInfo.colors) {
            if (!fieldNames.includes(color.field)) {
                fieldNames.push(color.field);
            }
        }

        if (
            archInfo.dependency_arrow &&
            !fieldNames.includes(archInfo.dependency_arrow)
        ) {
            fieldNames.push(archInfo.dependency_arrow);
        }
        if (archInfo.day_mode) {
            Object.assign(archInfo.options, this.get_day_mode_options());
        }
        archInfo.fieldNames = fieldNames;
        return archInfo;
    }
    /**
     * Vis-timeline options for day_mode: items snap to the start of the day
     * and the axis never zooms below one day.
     * @returns {Object}
     */
    get_day_mode_options() {
        const one_day = 24 * 60 * 60 * 1000;
        return {
            snap: (date) => DateTime.fromJSDate(date).startOf("day").toJSDate(),
            zoomMin: one_day,
            zoomMax: 365 * one_day,
            timeAxis: {scale: "day", step: 1},
            format: {
                minorLabels: {day: "D", weekday: "ddd D"},
                majorLabels: {day: "MMMM YYYY", week: "MMMM YYYY", month: "YYYY"},
            },
        };
    }
    /**
     * Parse the colors attribute.
     * @param {Array} colors
     * @returns {Array}
     */
    parse_colors(colors) {
        if (colors) {
            return colors
                .split(";")
                .filter(Boolean)
                .map((color_pair) => {
                    const [color, expr] = color_pair.split(":");
                    const ast = parseExpr(expr);
                    return {
                        color: color,
                        field: ast.left.value,
                        ast,
                    };
                });
        }
        return [];
    }
}
