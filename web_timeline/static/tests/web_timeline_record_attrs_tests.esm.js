/* Copyright 2026 BITVAX
 * License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl). */

import {
    findChildren,
    nextTick,
    patchTimeZone,
    patchWithCleanup,
} from "@web/../tests/helpers/utils";
import {makeView, setupViewRegistries} from "@web/../tests/views/helpers";
import {FAKE_ORDER_FIELDS} from "./helpers.esm";
import {TimelineArchParser} from "@web_timeline/views/timeline/timeline_arch_parser.esm";
import {TimelineRenderer} from "@web_timeline/views/timeline/timeline_renderer.esm";
import {parseXML} from "@web/core/utils/xml";

const {DateTime} = luxon;

// The rental timeline of a joint calendar: one row per rented product (a char
// field), a color per record, and confirmed orders locked.
const RENTAL_ARCH = `
    <timeline date_start="date_start"
              date_stop="date_stop"
              default_group_by="group_by"
              event_open_popup="true"
              color_field="timeline_color"
              readonly_field="readonly"
              edit_group="false"
              all_day="all_day"
              day_mode="true"
              use_formview_action="1"/>`;

let serverData = {};

/**
 * A local (UTC+2) wall time as a JS Date, the way vis-timeline hands it over.
 * @param {String} iso
 * @returns {Date}
 */
function local(iso) {
    return DateTime.fromISO(iso).toJSDate();
}

/**
 * @param {Date} date
 * @returns {String} local ISO representation, to compare readable values
 */
function toLocalISO(date) {
    return DateTime.fromJSDate(date).toISO({suppressMilliseconds: true});
}

/**
 * A server record by id (the mock server sorts the list in place on reads).
 * @param {Number} id
 * @returns {Object}
 */
function rental(id) {
    return serverData.models.rental.records.find((record) => record.id === id);
}

/**
 * MockRPC that keeps the arguments of every write instead of running it: the
 * legacy mock server only takes a list of ids, while the timeline writes one
 * id at a time (which the ORM accepts).
 * @param {Array} writes
 * @returns {Function}
 */
function recordWrites(writes) {
    return (route, args) => {
        if (args.method === "write") {
            writes.push(args.args);
            return true;
        }
    };
}

async function makeTimeline(arch, mockRPC) {
    const controller = await makeView({
        type: "timeline",
        resModel: "rental",
        serverData,
        arch,
        mockRPC,
    });
    const renderer = findChildren(
        controller,
        (node) => node.component instanceof TimelineRenderer
    ).component;
    // Let vis-timeline do its first redraw, then load the items ourselves so
    // the assertions do not depend on the redraw timing.
    await nextTick();
    await renderer.on_data_loaded(controller.model.data);
    return {controller, renderer};
}

QUnit.module("TimelineView - Record attributes", (hooks) => {
    hooks.beforeEach(() => {
        patchTimeZone(120);
        serverData = {
            models: {
                rental: {
                    fields: {
                        display_name: {string: "Display Name", type: "char"},
                        date_start: {string: "Start", type: "datetime"},
                        date_stop: {string: "End", type: "datetime"},
                        all_day: {string: "Whole Day", type: "boolean"},
                        group_by: {string: "Group by", type: "char"},
                        state: {
                            string: "State",
                            type: "selection",
                            selection: [
                                ["draft", "Quotation"],
                                ["sale", "Sales Order"],
                            ],
                        },
                        timeline_color: {string: "Color", type: "char"},
                        readonly: {string: "Readonly", type: "boolean"},
                    },
                    records: [
                        {
                            // Confirmed order, 2 and 3 January (local time)
                            id: 1,
                            display_name: "Confirmed",
                            date_start: "2024-01-01 22:00:00",
                            date_stop: "2024-01-03 21:59:59",
                            all_day: true,
                            group_by: "Boat A",
                            state: "sale",
                            timeline_color: "#ff0000",
                            readonly: true,
                        },
                        {
                            // Quotation, 5 January (local time)
                            id: 2,
                            display_name: "Quotation",
                            date_start: "2024-01-04 22:00:00",
                            date_stop: "2024-01-05 21:59:59",
                            all_day: true,
                            group_by: "Boat B",
                            state: "draft",
                            timeline_color: "#00ff00",
                            readonly: false,
                        },
                        {
                            id: 3,
                            display_name: "Quotation without color",
                            date_start: "2024-01-09 22:00:00",
                            date_stop: "2024-01-10 21:59:59",
                            all_day: true,
                            group_by: "Boat A",
                            state: "draft",
                            timeline_color: false,
                            readonly: false,
                        },
                    ],
                    methods: {
                        has_access() {
                            return Promise.resolve(true);
                        },
                    },
                },
            },
        };
        setupViewRegistries();
    });

    QUnit.test("arch parser reads the record attributes", (assert) => {
        const parser = new TimelineArchParser();
        const archInfo = parser.parse(parseXML(RENTAL_ARCH), FAKE_ORDER_FIELDS);
        assert.strictEqual(archInfo.color_field, "timeline_color");
        assert.strictEqual(archInfo.readonly_field, "readonly");
        assert.strictEqual(archInfo.all_day, "all_day");
        assert.strictEqual(archInfo.canUpdateGroup, false);
        assert.strictEqual(archInfo.day_mode, true);
        assert.strictEqual(archInfo.use_formview_action, true);
        for (const field of ["timeline_color", "readonly", "all_day"]) {
            assert.ok(archInfo.fieldNames.includes(field), `${field} is read`);
        }
        assert.strictEqual(
            archInfo.options.timeAxis.scale,
            "day",
            "day_mode keeps the axis in days"
        );
        assert.strictEqual(
            toLocalISO(archInfo.options.snap(local("2024-01-05T15:30:00"))),
            "2024-01-05T00:00:00+02:00",
            "day_mode snaps to the start of the day"
        );

        const defaults = parser.parse(
            parseXML(
                `<timeline date_start="date_start" default_group_by="partner_id"/>`
            ),
            FAKE_ORDER_FIELDS
        );
        assert.strictEqual(defaults.canUpdateGroup, true);
        assert.strictEqual(defaults.day_mode, false);
        assert.strictEqual(defaults.use_formview_action, false);
        assert.notOk(defaults.options.snap, "no snapping without day_mode");
    });

    QUnit.test("color_field paints each item, colors still win", async (assert) => {
        const {renderer} = await makeTimeline(RENTAL_ARCH);
        const items = renderer.timeline.itemsData;
        assert.strictEqual(items.get(1).style, "background-color: #ff0000;");
        assert.strictEqual(items.get(2).style, "background-color: #00ff00;");
        assert.strictEqual(items.get(3).style, "", "no color, no style");
    });

    QUnit.test("colors take precedence over color_field", async (assert) => {
        const arch = RENTAL_ARCH.replace(
            "<timeline ",
            `<timeline colors="#0000ff: state == 'sale'" `
        );
        const {renderer} = await makeTimeline(arch);
        const items = renderer.timeline.itemsData;
        assert.strictEqual(items.get(1).style, "background-color: #0000ff;");
        assert.strictEqual(items.get(2).style, "background-color: #00ff00;");
    });

    QUnit.test("color_field ignores values that are not a color", async (assert) => {
        rental(2).timeline_color = "red; display: none";
        const {renderer} = await makeTimeline(RENTAL_ARCH);
        assert.strictEqual(renderer.timeline.itemsData.get(2).style, "");
    });

    QUnit.test("grouping by a char field makes one row per value", async (assert) => {
        serverData.models.rental.records.push({
            id: 4,
            display_name: "Without product",
            date_start: "2024-01-11 22:00:00",
            date_stop: "2024-01-12 21:59:59",
            group_by: false,
        });
        const {renderer} = await makeTimeline(RENTAL_ARCH);
        const groups = renderer.timeline.groupsData;
        assert.deepEqual(groups.getIds(), [-1, "Boat A", "Boat B"]);
        assert.strictEqual(groups.get("Boat A").content, "Boat A");
        const items = renderer.timeline.itemsData;
        assert.strictEqual(items.get(1).group, "Boat A");
        assert.strictEqual(items.get(2).group, "Boat B");
        assert.strictEqual(items.get(3).group, "Boat A");
        assert.strictEqual(items.get(4).group, -1, "empty value: unassigned row");
    });

    // One view per test: the test env cannot be built twice in the same test
    QUnit.test("char rows are escaped", async (assert) => {
        rental(1).group_by = "<b>Boat</b>";
        const {renderer} = await makeTimeline(RENTAL_ARCH);
        assert.strictEqual(
            renderer.timeline.groupsData.get("<b>Boat</b>").content,
            "&lt;b&gt;Boat&lt;/b&gt;"
        );
    });

    QUnit.test("selection rows use the label", async (assert) => {
        const {renderer} = await makeTimeline(
            RENTAL_ARCH.replace(
                'default_group_by="group_by"',
                'default_group_by="state"'
            )
        );
        const groups = renderer.timeline.groupsData;
        assert.strictEqual(groups.get("sale").content, "Sales Order");
        assert.strictEqual(groups.get("draft").content, "Quotation");
    });

    QUnit.test("clicking a char row label opens nothing", async (assert) => {
        const {controller} = await makeTimeline(RENTAL_ARCH);
        patchWithCleanup(controller.actionService, {
            doAction: () => assert.step("doAction"),
        });
        controller._onGroupClick({group: "Boat A"});
        assert.verifySteps([]);
    });

    QUnit.test("readonly_field locks the item in vis-timeline", async (assert) => {
        const {renderer} = await makeTimeline(RENTAL_ARCH);
        const data = renderer.timeline.itemsData;
        assert.strictEqual(data.get(1).editable, false);
        assert.strictEqual(data.get(1).className, "web_timeline_readonly");
        assert.strictEqual(data.get(2).editable, undefined);
        // What vis-timeline checks before letting an item be dragged or resized
        const items = renderer.timeline.itemSet.items;
        assert.strictEqual(items[1].editable.updateTime, false, "readonly: no drag");
        assert.strictEqual(items[1].editable.updateGroup, false);
        assert.strictEqual(items[2].editable.updateTime, true, "quotation: drag");
        assert.strictEqual(
            items[2].editable.updateGroup,
            false,
            "edit_group=false: no row change"
        );
        assert.strictEqual(renderer.options.editable.updateGroup, false);
    });

    QUnit.test(
        "double click on a readonly item runs get_formview_action",
        async (assert) => {
            const action = {
                type: "ir.actions.act_window",
                res_model: "sale.order",
                res_id: 42,
                views: [[false, "form"]],
                target: "current",
            };
            const {controller, renderer} = await makeTimeline(
                RENTAL_ARCH,
                (route, args) => {
                    if (args.method === "get_formview_action") {
                        assert.step(`get_formview_action ${JSON.stringify(args.args)}`);
                        return action;
                    }
                }
            );
            patchWithCleanup(controller.actionService, {
                doAction: (act) =>
                    assert.step(`doAction ${act.res_model},${act.res_id}`),
            });
            patchWithCleanup(controller.dialogService, {
                add: () => assert.step("dialog"),
            });

            renderer.on_timeline_double_click({what: "item", item: 1});
            await nextTick();
            assert.verifySteps(["get_formview_action [[1]]", "doAction sale.order,42"]);

            // Editable items are opened by vis-timeline through onUpdate
            renderer.on_timeline_double_click({what: "item", item: 2});
            await nextTick();
            assert.verifySteps([]);
        }
    );

    QUnit.test("double tap on a readonly item creates nothing", async (assert) => {
        const {controller, renderer} = await makeTimeline(RENTAL_ARCH);
        patchWithCleanup(controller.dialogService, {
            add: () => assert.step("create dialog"),
        });
        const itemSet = renderer.timeline.itemSet;
        const newItem = {start: local("2024-01-02T10:00:00"), group: "Boat A"};

        // The double tap began on the readonly item: vis-timeline still calls
        // onAdd, and the renderer cancels it.
        itemSet.touchParams.item = itemSet.items[1];
        renderer.on_add(newItem, (item) => assert.step(`callback ${item}`));
        assert.verifySteps(["callback null"]);

        // On empty space the creation dialog opens as before
        itemSet.touchParams.item = null;
        renderer.on_add(newItem, () => assert.step("callback"));
        assert.verifySteps(["create dialog"]);
    });

    QUnit.test("day_mode shows whole days", async (assert) => {
        const {renderer} = await makeTimeline(RENTAL_ARCH);
        const item = renderer.timeline.itemsData.get(2);
        assert.strictEqual(toLocalISO(item.start), "2024-01-05T00:00:00+02:00");
        assert.strictEqual(toLocalISO(item.end), "2024-01-06T00:00:00+02:00");
    });

    QUnit.test(
        "moving a quotation keeps its row and its duration (edit_group=false)",
        async (assert) => {
            const writes = [];
            const {controller} = await makeTimeline(RENTAL_ARCH, recordWrites(writes));
            // Dragged two days later: vis-timeline keeps the length of the bar
            controller._onMove(
                {
                    id: 2,
                    start: local("2024-01-07T00:00:00"),
                    end: local("2024-01-08T00:00:00"),
                    group: "Boat B",
                    evt: rental(2),
                },
                () => assert.step("moved")
            );
            await nextTick();
            await nextTick();
            assert.verifySteps(["moved"]);
            // Same 23:59:59 span two days later, and no group_by at all
            assert.deepEqual(writes, [
                [
                    2,
                    {
                        date_start: "2024-01-06 22:00:00",
                        date_stop: "2024-01-07 21:59:59",
                    },
                ],
            ]);
        }
    );

    QUnit.test("moving with edit_group writes the char row back", async (assert) => {
        const writes = [];
        const {controller} = await makeTimeline(
            RENTAL_ARCH.replace('edit_group="false"', ""),
            recordWrites(writes)
        );
        controller._onMove(
            {
                id: 2,
                start: local("2024-01-07T00:00:00"),
                end: local("2024-01-08T00:00:00"),
                group: "Boat B",
                evt: rental(2),
            },
            () => assert.step("moved")
        );
        await nextTick();
        await nextTick();
        assert.verifySteps(["moved"]);
        assert.strictEqual(writes[0][1].group_by, "Boat B", "not False");
    });

    QUnit.test("day_mode: resizing does not add a day", async (assert) => {
        const writes = [];
        const {controller} = await makeTimeline(RENTAL_ARCH, recordWrites(writes));
        // Right edge dragged to the end of 8 January: vis-timeline hands over
        // the start of 9 January.
        controller._onMove(
            {
                id: 2,
                start: local("2024-01-05T00:00:00"),
                end: local("2024-01-09T00:00:00"),
                group: "Boat B",
                evt: rental(2),
            },
            () => assert.step("resized")
        );
        await nextTick();
        await nextTick();
        assert.verifySteps(["resized"]);
        assert.deepEqual(writes[0][1], {
            date_start: "2024-01-04 22:00:00",
            date_stop: "2024-01-08 21:59:59",
        });
    });

    QUnit.test(
        "all_day records drop the extra second of vis-timeline",
        async (assert) => {
            const writes = [];
            const {controller} = await makeTimeline(
                RENTAL_ARCH.replace('day_mode="true"', ""),
                recordWrites(writes)
            );
            controller._onMove(
                {
                    id: 2,
                    start: local("2024-01-05T00:00:00"),
                    end: local("2024-01-09T00:00:00"),
                    group: "Boat B",
                    evt: rental(2),
                },
                () => assert.step("all day")
            );
            await nextTick();
            await nextTick();
            controller._onMove(
                {
                    id: 3,
                    start: local("2024-01-05T00:00:00"),
                    end: local("2024-01-09T00:00:00"),
                    group: "Boat A",
                    evt: {...rental(3), all_day: false},
                },
                () => assert.step("not all day")
            );
            await nextTick();
            await nextTick();
            assert.verifySteps(["all day", "not all day"]);
            assert.strictEqual(writes[0][1].date_stop, "2024-01-08 21:59:59");
            assert.strictEqual(
                writes[1][1].date_stop,
                "2024-01-08 22:00:00",
                "untouched"
            );
        }
    );
});
