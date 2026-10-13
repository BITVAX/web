/* Copyright 2026 BITVAX
 * License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl). */

import {registry} from "@web/core/registry";

/**
 * @param {Element} el
 * @param {String} expected computed background color
 */
function checkBackground(el, expected) {
    const color = getComputedStyle(el).backgroundColor;
    if (color !== expected) {
        throw new Error(`Item background is ${color}, expected ${expected}`);
    }
}

registry.category("web_tour.tours").add("web_timeline_tour", {
    steps: () => [
        {
            // Dumps the rendered timeline to the browser console, so selectors
            // can be adapted without guessing when the layout changes.
            content: "dump timeline DOM on load",
            trigger: ".oe_timeline_view .vis-item",
            run() {
                const view = document.querySelector(".oe_timeline_view");
                for (const el of view.querySelectorAll(".vis-label, .vis-item")) {
                    console.log(
                        "[web_timeline_tour]",
                        el.className,
                        "|",
                        el.textContent.trim(),
                        "|",
                        el.getAttribute("style")
                    );
                }
            },
        },
        {
            content: "char field rows: one per value",
            trigger: ".vis-label:contains(Timeline Row A)",
        },
        {
            trigger: ".vis-label:contains(Timeline Row B)",
        },
        {
            content: "readonly item is locked and painted from color_field",
            trigger: ".vis-item.web_timeline_readonly.vis-readonly",
            run() {
                checkBackground(this.anchor, "rgb(255, 0, 0)");
            },
        },
        {
            content: "editable item keeps its own color",
            trigger: ".vis-item.vis-editable:not(.web_timeline_readonly)",
            run() {
                checkBackground(this.anchor, "rgb(0, 255, 0)");
            },
        },
        {
            content: "double click on the readonly item",
            trigger: ".vis-item.web_timeline_readonly",
            run: "dblclick",
        },
        {
            content: "get_formview_action decided which record opens",
            trigger: ".o_breadcrumb:contains(Timeline Redirect Target)",
        },
        {
            content: "in the main area: no popup and no creation dialog",
            trigger: "body:not(:has(.modal))",
        },
    ],
});
