import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface BroadbandBreakdownProps {
  data: any[];
}

export const BroadbandBreakdown = ({ data }: BroadbandBreakdownProps) => {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>📡 Broadband Bill</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No broadband bill data available</p>
        </CardContent>
      </Card>
    );
  }

  const bill = data[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          📡 Broadband Bill Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Supplier & Account Information */}
        <div>
          <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Supplier & Account Info</h4>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Supplier</TableCell>
                <TableCell>{bill.supplier || 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Account Number</TableCell>
                <TableCell className="font-mono">{bill.account_no || 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Package</TableCell>
                <TableCell>{bill.package || 'N/A'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Phone Numbers */}
        {bill.phone_no && bill.phone_no.length > 0 && (
          <div>
            <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Phone Numbers</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.phone_no.map((phone: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono">{phone.phone_no || 'N/A'}</TableCell>
                    <TableCell>{phone.phone_type || 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Billing Period */}
        <div>
          <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Billing Period</h4>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Period Start</TableCell>
                <TableCell>{bill.period_start || 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Period End</TableCell>
                <TableCell>{bill.period_end || 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Bill Date</TableCell>
                <TableCell>{bill.bill_date || 'N/A'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Payment Due Date</TableCell>
                <TableCell>{bill.payment_due_date || 'N/A'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Financial Summary */}
        <div>
          <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Financial Summary</h4>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Previous Balance</TableCell>
                <TableCell>€{bill.previous_balance?.toFixed(2) || '0.00'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Current Charges</TableCell>
                <TableCell>€{bill.current_charges?.toFixed(2) || '0.00'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">VAT</TableCell>
                <TableCell>€{bill.vat?.toFixed(2) || '0.00'}</TableCell>
              </TableRow>
              <TableRow className="border-t-2">
                <TableCell className="font-bold">Total Amount Due</TableCell>
                <TableCell className="font-bold text-lg">€{bill.total_amount_due?.toFixed(2) || '0.00'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Additional Charges */}
        {bill.other_charges && bill.other_charges.length > 0 && (
          <div>
            <h4 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wider">Additional Charges</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.other_charges.map((charge: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{charge.description || 'N/A'}</TableCell>
                    <TableCell className="text-right">€{charge.amount?.toFixed(2) || '0.00'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
