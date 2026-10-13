# Copyright 2026 BITVAX
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl.html).
from unittest.mock import patch

from odoo.tests import tagged
from odoo.tests.common import HttpCase


@tagged("post_install", "-at_install")
class TestTimelineRecordAttributes(HttpCase):
    """Attributes that act on each record of the timeline.

    - color_field: the item background comes from a field of the record.
    - readonly_field: a truthy value locks the item (no drag nor resize),
      while a double click still opens it.
    - use_formview_action: opening an item goes through the model's
      get_formview_action, so the model decides which record is shown.
    - A char field as default_group_by makes one row per value.

    The tour runs on res.partner, so web_timeline needs no other module: the
    items span the day the partners are created on.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.locked_partner = cls.env["res.partner"].create(
            {
                "name": "Timeline Locked",
                "is_company": True,
                "function": "Timeline Row A",
                "ref": "#ff0000",
            }
        )
        cls.free_partner = cls.env["res.partner"].create(
            {
                "name": "Timeline Free",
                "function": "Timeline Row B",
                "ref": "#00ff00",
            }
        )
        cls.target_partner = cls.env["res.partner"].create(
            {"name": "Timeline Redirect Target"}
        )
        partner_ids = (cls.locked_partner | cls.free_partner).ids
        timeline_view = cls.env["ir.ui.view"].create(
            {
                "name": "res.partner.timeline.test",
                "model": "res.partner",
                "type": "timeline",
                "arch": """
                    <timeline date_start="create_date"
                              date_stop="create_date"
                              default_group_by="function"
                              event_open_popup="true"
                              color_field="ref"
                              readonly_field="is_company"
                              edit_group="false"
                              day_mode="true"
                              use_formview_action="1"/>
                """,
            }
        )
        cls.timeline_action = cls.env["ir.actions.act_window"].create(
            {
                "name": "Web Timeline Test Partners",
                "res_model": "res.partner",
                "view_mode": "timeline,form",
                "view_id": timeline_view.id,
                "domain": f"[('id', 'in', {partner_ids})]",
            }
        )

    def test_timeline_record_attributes(self):
        self.browser_js(
            "/web/tests/legacy?mod=web&filter=TimelineView - Record attributes",
            "",
            login="admin",
            timeout=1800,
            success_signal="QUnit test suite done.",
        )

    def test_timeline_tour(self):
        # A model that redirects get_formview_action, as joint.event does
        # towards the document behind each event.
        redirect = self.target_partner.get_formview_action()
        partner_class = type(self.env["res.partner"])
        with patch.object(
            partner_class,
            "get_formview_action",
            lambda records, access_uid=None: redirect,
        ):
            self.start_tour(
                f"/odoo/action-{self.timeline_action.id}",
                "web_timeline_tour",
                login="admin",
            )
